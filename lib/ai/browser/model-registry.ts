/**
 * Browser model registry — pinned models + size/memory budgets.
 *
 * Single source of truth for EVERY on-device model the platform loads.
 * Patterns referenced (no new runtimes added):
 *   · Transformers.js — ONNX weights over WebGPU, WASM fallback, feature-
 *     extraction embeddings (mean-pooled, cosine-scored for in-worker RAG).
 *   · WebLLM — local-chat pattern: one cached engine per model, progressive
 *     token callbacks for streaming render, CacheStorage persistence.
 *     Implemented on top of the Transformers.js text-generation pipeline so
 *     the bundle keeps exactly one inference runtime.
 *
 * Prisma-free and pure — safe to import from workers, tests and the server.
 */

export type BrowserTask = "chat" | "asr" | "translation" | "embeddings" | "vision-ocr";
export type DeviceKind = "webgpu" | "wasm";
export type TierName = "high" | "medium" | "low";

export type ModelPin = {
  /** Exact Hugging Face id — the only revision the platform may load. */
  id: string;
  task: BrowserTask;
  /** Approx parameters (millions), 0 when not applicable. */
  paramsM: number;
  /** Approx one-time download (MB). Honest estimates, not marketing. */
  sizeMb: number;
  /** Approx peak working memory at the pinned precision (MB). */
  memoryMb: number;
  /** Weakest tier allowed to load this pin. */
  minTier: TierName;
  /** Preferred backend; pipelines fall back to WASM automatically. */
  device: DeviceKind;
  /** Pinned precision per tier is resolved by capabilities, not here. */
  role: string;
  /** When true the pin never auto-loads — explicit opt-in only. */
  optInOnly?: boolean;
};

export const MODEL_REGISTRY: Record<BrowserTask, ModelPin> = {
  // WebLLM-pattern local chat. LFM2-350M is the pinned default: multilingual,
  // instruction-tuned, fast on WebGPU and usable on WASM/q4. The WebLLM
  // reference model (Qwen3-1.7B-q4f16, ~1 GB) is documented as the high-tier
  // upgrade path but NOT pinned — it exceeds the medium-tier budget below.
  chat: {
    id: "onnx-community/LFM2-350M-ONNX",
    task: "chat",
    paramsM: 350,
    sizeMb: 200,
    memoryMb: 512,
    minTier: "low",
    device: "webgpu",
    role: "local chat + voice-command classifier (WebLLM streaming pattern)",
  },
  // Whisper lite — per-language smallest usable (xenova/whisper-web pattern).
  asr: {
    id: "Xenova/whisper-tiny",
    task: "asr",
    paramsM: 39,
    sizeMb: 75,
    memoryMb: 256,
    minTier: "low",
    device: "wasm",
    role: "multilingual speech-to-text (English-only pin: Xenova/whisper-tiny.en, ~40 MB)",
  },
  // NLLB distilled — large; built-in browser Translation API always runs first.
  translation: {
    id: "Xenova/nllb-200-distilled-600M",
    task: "translation",
    paramsM: 600,
    sizeMb: 650,
    memoryMb: 1024,
    minTier: "medium",
    device: "webgpu",
    role: "fallback translation when the built-in on-device API is absent",
  },
  // Nomic embeddings — in-worker RAG over sqlite-vec style stores.
  embeddings: {
    id: "Xenova/nomic-embed-text-v1",
    task: "embeddings",
    paramsM: 137,
    sizeMb: 130,
    memoryMb: 256,
    minTier: "low",
    device: "wasm",
    role: "feature-extraction embeddings, mean-pooled, cosine-scored",
  },
  // Florence-2 — vision assist for OCR region proposal. Budget-heavy:
  // high tier only, never auto-loaded (warm-up must opt in explicitly).
  "vision-ocr": {
    id: "Xenova/Florence-2-base",
    task: "vision-ocr",
    paramsM: 230,
    sizeMb: 500,
    memoryMb: 1024,
    minTier: "high",
    device: "webgpu",
    role: "optional OCR region proposal (Tesseract stays the default reader)",
    optInOnly: true,
  },
};

/** WebLLM reference model (documented upgrade path, not auto-loaded). */
export const WEBLLM_REFERENCE_MODEL = "Qwen3-1.7B-q4f16";

/** Cache + memory budgets (MB). */
export const CACHE_BUDGETS = {
  /** Warn in telemetry once the pinned working set exceeds this. */
  warnMb: 1500,
  /** Hard cap: pipelines refuse new loads past this (offline-degraded). */
  capMb: 2048,
  /** Strongest single model each tier may load. */
  perTierMaxMb: { high: 700, medium: 650, low: 250 } as Record<TierName, number>,
} as const;

const TIER_RANK: Record<TierName, number> = { low: 0, medium: 1, high: 2 };

/** The pin for a task, or null when the tier may not load it. */
export function pinFor(task: BrowserTask, tier: TierName): ModelPin | null {
  const pin = MODEL_REGISTRY[task];
  if (!pin) return null;
  if (TIER_RANK[tier] < TIER_RANK[pin.minTier]) return null;
  if (pin.sizeMb > CACHE_BUDGETS.perTierMaxMb[tier]) return null;
  return pin;
}

/** Approximate download size for budget accounting (0 for unknown ids). */
export function modelSizeMb(modelId: string): number {
  for (const pin of Object.values(MODEL_REGISTRY)) {
    if (pin.id === modelId) return pin.sizeMb;
    // Language-scoped Whisper variants share the multilingual budget line.
    if (pin.task === "asr" && modelId.startsWith("Xenova/whisper-tiny")) return 75;
  }
  return 0;
}

/** Working-set budget check for the whole pinned set a session holds. */
export function fitsCacheBudget(loadedMb: number): boolean {
  return loadedMb <= CACHE_BUDGETS.capMb;
}
