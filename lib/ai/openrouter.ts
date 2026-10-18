/**
 * OpenRouter provider — cloud LLM fallback in the AI cascade.
 *
 * The cascade order is:
 *   1. window.ai  — Chrome's built-in AI (zero config, zero cost)
 *   2. WebLLM     — local LLM in the browser (WebGPU/WASM)
 *   3. OpenRouter — cloud LLM API (requires OPENROUTER_API_KEY)
 *
 * OpenRouter is the LAST resort: it is the only provider that sends data
 * off-device. Storage law compliance (GDPR Art. 44-49) requires that any
 * cross-border transfer has a legal basis. We only send to OpenRouter when:
 *   - The user has explicitly opted in (feature flag)
 *   - The data has been stripped of PII before sending
 *   - The request is logged in the audit trail
 *
 * The API key is read from the environment and never exposed to the client.
 */
import { db } from "@/lib/db";
import type { ChatMessage } from "./providers";

export type OpenRouterModel = "openai/gpt-4o-mini" | "anthropic/claude-3-haiku" | "google/gemini-flash-1.5" | "meta-llama/llama-3.1-8b-instruct";

const DEFAULT_MODEL: OpenRouterModel = "openai/gpt-4o-mini";

export type OpenRouterResult = {
  text: string;
  provider: string;
  model: string;
};

/**
 * Check if OpenRouter is configured (server-side only).
 */
export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Call OpenRouter with a set of messages.
 * Returns null when not configured or on any error.
 */
export async function callOpenRouter(
  messages: ChatMessage[],
  opts?: { model?: OpenRouterModel; timeoutMs?: number }
): Promise<OpenRouterResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = opts?.model ?? DEFAULT_MODEL;
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://citizen-lane.vercel.app",
        "X-Title": "Citizen Lane",
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: 0.3,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;

    return { text, provider: "openrouter", model };
  } catch {
    return null;
  }
}

/**
 * Log an OpenRouter call to the audit trail (storage law compliance).
 * Records that a cross-border transfer occurred, what model was used,
 * and the legal basis. Does NOT log the actual content.
 */
export async function logOpenRouterCall(
  orgId: string | null,
  actorId: string | null,
  model: string,
  messageCount: number
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        orgId: orgId ?? undefined,
        actorId: actorId ?? undefined,
        actorLabel: "ai-cascade",
        action: "ai.openrouter.called",
        target: model,
        reason: `Cross-border transfer — GDPR Art. 46 SCC. ${messageCount} messages.`,
      },
    });
  } catch {
    // Never throw from logging
  }
}
