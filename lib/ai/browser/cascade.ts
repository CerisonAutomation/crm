"use client";

/**
 * Browser AI Cascade — PromptAPI (Nano, 0 MB) → Transformers chat (WebLLM
 * local-chat pattern) → WASM floor → server cost-capped proxy.
 *
 * Tier order is a cost + privacy order: every local tier keeps data on the
 * device (E17), the cloud tier runs ONLY with explicit cloud consent, PII
 * stripped client-side AND re-checked server-side, and the call audit-logged
 * (GDPR Art. 44–49). The OpenRouter call goes through /api/ai/cascade so the
 * API key never reaches the client.
 *
 * Lifecycle: warmChat() preloads during idle; runCascade() accepts an
 * AbortSignal (cancel button, unmount, navigation); evictChatModels() frees
 * weights under memory pressure. Offline or over-budget resolves to a typed
 * ModelUnavailable or a degraded CascadeResult — never a silent wrong answer.
 */

import {
  detectCapabilities,
  refreshOnlineState,
  canAfford,
  type Capabilities,
} from "./capabilities";
import {
  getPipeline,
  warmModel,
  evictModel,
  isModelCached,
  ModelUnavailable,
} from "./pipelines";
import { MODEL_REGISTRY, pinFor } from "./model-registry";
import { getAiConsent } from "./consent";
import { recordCapability } from "./telemetry";

export type CascadeTier = "window-ai" | "webllm" | "openrouter" | "unavailable";

/** Where an answer was computed — the local/cloud indicator reads this. */
export type Placement = "local" | "cloud" | "none";

export function placementOf(tier: CascadeTier): Placement {
  if (tier === "window-ai" || tier === "webllm") return "local";
  if (tier === "openrouter") return "cloud";
  return "none";
}

export type CascadeResult = {
  text: string;
  tier: CascadeTier;
  model: string;
  /** Whether PII was stripped before the cloud call. */
  piiStripped: boolean;
  /** Placement for the local/cloud indicator. */
  placement: Placement;
  /** Set when the answer is a fallback, not a full-quality inference. */
  degraded?: { reason: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CascadeOptions = {
  timeoutMs?: number;
  onProgress?: (tier: CascadeTier, progress: number) => void;
  /** WebLLM-pattern streaming: progressive token/chunk callbacks for render. */
  onToken?: (tier: CascadeTier, token: string) => void;
  /** Cancel in-flight work (button, unmount, navigation). */
  signal?: AbortSignal;
  /** For testing only. */
  forceTier?: CascadeTier;
};

// Minimal PII patterns to strip before cloud calls
const PII_PATTERNS = [
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // credit card
  /\b[A-Z]{2}\d{6,9}\b/g, // passport numbers
  /\b\d{2}\.\d{2}\.\d{4}\b/g, // dates (DD.MM.YYYY)
  /\b\d{4}-\d{2}-\d{2}\b/g, // dates (YYYY-MM-DD)
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // email
  /\+?\d{1,3}[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/g, // phone
];

function stripPii(text: string): { text: string; stripped: boolean } {
  let stripped = false;
  let result = text;
  for (const pattern of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, "[REDACTED]");
      stripped = true;
    }
  }
  return { text: result, stripped };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ModelUnavailable("cancelled", "Chat cancelled");
}

/** Emit text progressively so the UI streams even for non-streaming backends. */
function emitTokens(
  tier: CascadeTier,
  text: string,
  onToken?: CascadeOptions["onToken"]
): void {
  if (!onToken || !text) return;
  const chunks = text.match(/\S+\s*/g) ?? [text];
  for (const c of chunks) onToken(tier, c);
}

/**
 * Check if window.ai (Chrome Prompt API / Nano) is available.
 * Zero download, zero cost, fully on-device.
 */
export function windowAiAvailable(): boolean {
  if (globalThis.window === undefined) return false;
  const w = window as unknown as { ai?: { languageModel?: unknown } };
  return (
    typeof w.ai !== "undefined" && typeof w.ai.languageModel !== "undefined"
  );
}

/**
 * Create a window.ai session and generate text. Streams tokens via onToken.
 * Returns null if window.ai is unavailable or fails.
 */
export async function generateWithWindowAi(
  messages: ChatMessage[],
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onToken?: (t: string) => void;
  }
): Promise<string | null> {
  if (!windowAiAvailable()) return null;
  throwIfAborted(opts?.signal);
  const started = Date.now();
  try {
    // @ts-ignore - window.ai is not in TypeScript lib yet
    const session = await window.ai.languageModel.create({
      systemPrompt: messages.find((m) => m.role === "system")?.content ?? "",
    });
    throwIfAborted(opts?.signal);
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    const prompt = userMessages.join("\n\n");
    // @ts-ignore - window.ai types
    const stream = session.promptStreaming(prompt);
    let fullText = "";
    for await (const chunk of stream) {
      throwIfAborted(opts?.signal);
      const piece = String(chunk).slice(fullText.length);
      fullText = String(chunk);
      if (piece) opts?.onToken?.(piece);
    }
    await session.destroy().catch(() => undefined);
    recordCapability({
      task: "chat",
      model: "chrome-window-ai",
      latencyMs: Date.now() - started,
      outcome: "ok",
    });
    return fullText;
  } catch (err) {
    if (err instanceof ModelUnavailable) throw err;
    recordCapability({
      task: "chat",
      model: "chrome-window-ai",
      latencyMs: Date.now() - started,
      outcome: "failed",
    });
    return null;
  }
}

const CHAT_MODEL = MODEL_REGISTRY.chat.id;

/**
 * Generate text with the pinned local chat model (WebLLM local-chat pattern:
 * one cached engine, progressive render callbacks). Null when unloadable.
 */
export async function generateWithWebLLM(
  messages: ChatMessage[],
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (p: { status: string; progress: number }) => void;
    onToken?: (t: string) => void;
  }
): Promise<{ text: string; model: string } | null> {
  const caps = detectCapabilities();
  if (!caps.wasm && !caps.webgpu) return null;
  const pin = pinFor("chat", caps.tier);
  if (!pin) return null;
  throwIfAborted(opts?.signal);
  const started = Date.now();
  try {
    const pipe = await getPipeline("text-generation", pin.id, {
      device: caps.device,
      dtype: caps.dtype,
      onProgress: opts?.onProgress,
      signal: opts?.signal,
    });
    if (!pipe) {
      recordCapability({
        task: "chat",
        model: pin.id,
        latencyMs: Date.now() - started,
        outcome: "degraded",
        reason: "load-failed",
      });
      return null;
    }
    throwIfAborted(opts?.signal);
    const systemPrompt =
      messages.find((m) => m.role === "system")?.content ?? "";
    const userPrompt = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");
    const prompt = systemPrompt + "\n\n" + userPrompt + "\n\nAnswer:";
    // @ts-ignore - Transformers.js pipeline type
    const gen = pipe as unknown as (
      input: string,
      opts: Record<string, unknown>
    ) => Promise<Array<{ generated_text?: string }>>;
    const out = await gen(prompt, {
      max_new_tokens: 512,
      temperature: 0.3,
      do_sample: false,
    });
    throwIfAborted(opts?.signal);
    const text = out?.[0]?.generated_text ?? "";
    if (!text) return null;
    const answer = text.includes("Answer:")
      ? text.split("Answer:").pop()?.trim() ?? text
      : text;
    emitTokens(
      "webllm",
      answer,
      opts?.onToken ? (t) => opts.onToken?.(t) : undefined
    );
    recordCapability({
      task: "chat",
      model: pin.id,
      latencyMs: Date.now() - started,
      outcome: "ok",
    });
    return { text: answer, model: pin.id };
  } catch (err) {
    if (err instanceof ModelUnavailable) throw err;
    recordCapability({
      task: "chat",
      model: pin.id,
      latencyMs: Date.now() - started,
      outcome: "failed",
    });
    return null;
  }
}

/**
 * Call OpenRouter via the server proxy. Requires explicit cloud consent —
 * without it this tier is skipped (never fails closed into a cloud call).
 */
export async function generateWithOpenRouter(
  messages: ChatMessage[],
  opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ text: string; model: string; piiStripped: boolean } | null> {
  if (!getAiConsent().cloud) return null;
  const started = Date.now();
  try {
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const { text: strippedMessage, stripped } = stripPii(lastUserMessage);
    const sanitizedMessages = messages.map((m) =>
      m.role === "user" && m.content === lastUserMessage
        ? { ...m, content: strippedMessage }
        : m
    );
    throwIfAborted(opts?.signal);
    const res = await fetch("/api/ai/cascade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: sanitizedMessages }),
      signal: opts?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      recordCapability({
        task: "chat",
        model: "openrouter",
        latencyMs: Date.now() - started,
        outcome: "failed",
        reason: String(res.status),
      });
      return null;
    }
    const data = (await res.json()) as {
      text?: string;
      model?: string;
      error?: string;
    };
    if (!data.text) return null;
    recordCapability({
      task: "chat",
      model: data.model ?? "openrouter",
      latencyMs: Date.now() - started,
      outcome: "ok",
    });
    return {
      text: data.text,
      model: data.model ?? "openai/gpt-4o-mini",
      piiStripped: stripped,
    };
  } catch (err) {
    if (err instanceof ModelUnavailable) throw err;
    recordCapability({
      task: "chat",
      model: "openrouter",
      latencyMs: Date.now() - started,
      outcome: "failed",
    });
    return null;
  }
}

/** Settled outcome of a chat warm-up (reported, never thrown). */
export type ChatWarmOutcome =
  | "cached"
  | "ready"
  | "unavailable"
  | "cancelled"
  | "skipped-no-consent"
  | "skipped-over-budget";

/**
 * Best-effort: is the pinned chat model already persisted in CacheStorage?
 * True means the next warm (or local answer) needs no download.
 */
export async function isChatModelCached(): Promise<boolean> {
  try {
    const caps = detectCapabilities();
    const pin = pinFor("chat", caps.tier);
    if (!pin) return false;
    return await isModelCached(pin.id);
  } catch {
    return false;
  }
}

/**
 * Warm-up: preload the pinned chat model in the background. Never throws.
 *
 * Guards, in order: local-AI consent, per-tier size budget, then the
 * CacheStorage probe - a cache hit settles cached with NO download.
 * Progress is silent (a 0..100 callback for status surfaces, never a
 * toast), and the returned cancel aborts an in-flight download.
 *
 * Scheduling (requestIdleCallback vs fallback) is owned by the caller -
 * see scheduleIdleChatWarm in ./warm, used by the app-shell mount.
 */
export function warmChat(opts?: {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onSettled?: (outcome: ChatWarmOutcome) => void;
  warm?: typeof warmModel;
  checkCache?: (modelId: string) => Promise<boolean>;
  /** Test seam: replaces the localStorage consent read (always false in Node). */
  hasConsent?: () => boolean;
  /**
   * Injected capability snapshot — defaults to live detection.
   *
   * An injected dependency like `warm`/`checkCache`/`hasConsent`, and for the
   * same reason: the size/memory budget gate is a property of the DEVICE, so a
   * caller that supplies its own warm and cache probe must also be able to say
   * which device it is simulating. Without it, warm-up is untestable off a
   * capable host — see tests/ai-background-warm.test.ts.
   */
  capabilities?: Capabilities;
}): () => void {
  const settle = (o: ChatWarmOutcome): void => {
    try {
      opts?.onSettled?.(o);
    } catch {
      /* status sinks never break warm-up */
    }
  };
  const cancelNoop = (): void => undefined;
  try {
    if (opts?.signal?.aborted) {
      settle("cancelled");
      return cancelNoop;
    }
    const consentOk =
      opts && opts.hasConsent ? opts.hasConsent() : getAiConsent().local;
    if (!consentOk) {
      settle("skipped-no-consent");
      return cancelNoop;
    }
    const caps = opts?.capabilities ?? detectCapabilities();
    const pin = pinFor("chat", caps.tier);
    if (!pin || !canAfford(caps, pin.sizeMb, pin.memoryMb)) {
      settle("skipped-over-budget");
      return cancelNoop;
    }
    const inner = new AbortController();
    const onExternalAbort = (): void => inner.abort();
    opts?.signal?.addEventListener("abort", onExternalAbort, { once: true });
    const cancel = (): void => {
      try {
        opts?.signal?.removeEventListener("abort", onExternalAbort);
        inner.abort();
      } catch {
        /* cancel never throws */
      }
    };
    const runWarm = opts?.warm ?? warmModel;
    const check = opts?.checkCache ?? isModelCached;
    void (async () => {
      try {
        if (inner.signal.aborted) {
          settle("cancelled");
          return;
        }
        let cached = false;
        try {
          cached = await check(pin.id);
        } catch {
          cached = false;
        }
        if (inner.signal.aborted) {
          settle("cancelled");
          return;
        }
        if (cached) {
          try {
            opts?.onProgress?.(100);
          } catch {
            /* silent progress never throws */
          }
          recordCapability({
            task: "chat",
            model: pin.id,
            latencyMs: 0,
            outcome: "ok",
            reason: "cache-hit",
          });
          settle("cached");
          return;
        }
        const ok = await runWarm("text-generation", pin.id, {
          device: caps.device,
          dtype: caps.dtype,
          signal: inner.signal,
          onProgress: (p) => {
            try {
              opts?.onProgress?.(p.progress);
            } catch {
              /* silent progress never throws */
            }
          },
        });
        if (inner.signal.aborted) {
          settle("cancelled");
          return;
        }
        recordCapability({
          task: "chat",
          model: pin.id,
          latencyMs: 0,
          outcome: ok ? "ok" : "degraded",
          reason: ok ? undefined : "warmup-failed",
        });
        settle(ok ? "ready" : "unavailable");
      } catch {
        try {
          settle(inner.signal.aborted ? "cancelled" : "unavailable");
        } catch {
          /* never throws */
        }
      } finally {
        try {
          opts?.signal?.removeEventListener("abort", onExternalAbort);
        } catch {
          /* never throws */
        }
      }
    })();
    return cancel;
  } catch {
    settle("unavailable");
    return cancelNoop;
  }
}

/** Evict cached chat weights (memory pressure / sign-out). Returns evicted count. */
export function evictChatModels(): number {
  return evictModel(CHAT_MODEL);
}

/**
 * Main cascade entry point — tries each tier in order until one succeeds.
 * Cancellation rejects with ModelUnavailable("cancelled"); every other
 * dead-end degrades to the next tier, ending in a degraded result that says
 * so honestly instead of inventing an answer.
 */
export async function runCascade(
  messages: ChatMessage[],
  opts?: CascadeOptions
): Promise<CascadeResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const forceTier = opts?.forceTier;
  const signal = opts?.signal;
  const onToken = opts?.onToken;
  throwIfAborted(signal);
  refreshOnlineState();

  // Tier 1: PromptAPI / Nano (0 MB, on-device)
  if (!forceTier || forceTier === "window-ai") {
    opts?.onProgress?.("window-ai", 0);
    const result = await generateWithWindowAi(messages, {
      timeoutMs,
      signal,
      onToken: onToken ? (t) => onToken("window-ai", t) : undefined,
    });
    if (result) {
      opts?.onProgress?.("window-ai", 100);
      return {
        text: result,
        tier: "window-ai",
        model: "chrome-window-ai",
        piiStripped: false,
        placement: "local",
      };
    }
    opts?.onProgress?.("window-ai", 100);
  }
  throwIfAborted(signal);

  // Tier 2: pinned local chat (WebLLM pattern over Transformers.js)
  if (!forceTier || forceTier === "webllm") {
    opts?.onProgress?.("webllm", 0);
    try {
      const result = await generateWithWebLLM(messages, {
        timeoutMs,
        signal,
        onProgress: (p) => opts?.onProgress?.("webllm", p.progress),
        onToken: onToken ? (t) => onToken("webllm", t) : undefined,
      });
      if (result) {
        opts?.onProgress?.("webllm", 100);
        return {
          text: result.text,
          tier: "webllm",
          model: result.model,
          piiStripped: false,
          placement: "local",
        };
      }
    } catch (err) {
      if (err instanceof ModelUnavailable && err.reason === "cancelled")
        throw err;
      // Budget/offline/load failures fall through to the next tier.
    }
    opts?.onProgress?.("webllm", 100);
  }
  throwIfAborted(signal);

  // Tier 3: cloud proxy — consent-gated, PII-stripped, audit-logged, cost-capped.
  if (!forceTier || forceTier === "openrouter") {
    if (!getAiConsent().cloud) {
      return {
        text: "",
        tier: "unavailable",
        model: "none",
        piiStripped: false,
        placement: "none",
        degraded: {
          reason:
            "Cloud AI not consented — enable it in AI settings or ask your relationship manager.",
        },
      };
    }
    opts?.onProgress?.("openrouter", 0);
    const result = await generateWithOpenRouter(messages, {
      timeoutMs,
      signal,
    });
    if (result) {
      opts?.onProgress?.("openrouter", 100);
      return {
        text: result.text,
        tier: "openrouter",
        model: result.model,
        piiStripped: result.piiStripped,
        placement: "cloud",
      };
    }
    opts?.onProgress?.("openrouter", 100);
  }
  throwIfAborted(signal);

  const online =
    globalThis.navigator !== undefined ? navigator.onLine !== false : true;
  return {
    text: "",
    tier: "unavailable",
    model: "none",
    piiStripped: false,
    placement: "none",
    degraded: {
      reason: !online
        ? "You are offline and no model is cached yet. Reconnect once to download the on-device model, then AI works offline."
        : "All AI tiers are unavailable right now. Your case data is safe — try again or ask your relationship manager.",
    },
  };
}

/** Best available tier without running inference (status indicator). */
export async function getBestAvailableTier(): Promise<CascadeTier> {
  if (windowAiAvailable()) return "window-ai";
  const caps = detectCapabilities();
  if ((caps.wasm || caps.webgpu) && pinFor("chat", caps.tier)) return "webllm";
  if (!getAiConsent().cloud) return "unavailable";
  try {
    const res = await fetch("/api/ai/cascade/status", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.openrouterConfigured) return "openrouter";
    }
  } catch {
    // Ignore
  }
  return "unavailable";
}

/** Human-readable tier label for UI. */
export function tierLabel(tier: CascadeTier): string {
  switch (tier) {
    case "window-ai":
      return "Chrome AI (on-device)";
    case "webllm":
      return "Local model (on-device)";
    case "openrouter":
      return "Cloud model (OpenRouter)";
    case "unavailable":
      return "Unavailable";
  }
}
