"use client";
/**
 * Transformers.js pipeline cache — the model layer of the browser AI stack.
 *
 * One lazy, cached pipeline per (task, model, backend) so a model is downloaded
 * and initialised at most once per session and shared by every caller (Scribe,
 * translation, chat, embeddings…). Backend + precision come from the device
 * capability probe; size/memory budgets come from the model registry.
 *
 * Lifecycle: warm-up preloads without blocking; every load is cancelable via
 * AbortSignal; eviction drops idle pipelines LRU-first and enforces the
 * registry cache cap. Offline with nothing cached resolves to a typed
 * ModelUnavailable (reason "offline") — callers degrade, never throw raw.
 * Nothing here talks to an AI server: weights come once from the model CDN
 * and persist in CacheStorage (WebLLM caching pattern).
 */
import { detectCapabilities, canAfford } from "./capabilities";
import { CACHE_BUDGETS, modelSizeMb } from "./model-registry";
import type { Dtype } from "./capabilities";

export type PipelineProgress = (p: {
  status: "downloading" | "ready" | "error";
  progress: number;
  file?: string;
}) => void;

export type UnavailableReason =
  | "offline"
  | "budget"
  | "cancelled"
  | "load-failed"
  | "evicted";

/** Typed offline/degraded signal — callers show degraded UI, never raw errors. */
export class ModelUnavailable extends Error {
  reason: UnavailableReason;
  constructor(reason: UnavailableReason, detail?: string) {
    super(detail ?? "Model unavailable (" + reason + ")");
    this.name = "ModelUnavailable";
    this.reason = reason;
  }
}

type Loader = {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    useBrowserCache: boolean;
  };
  pipeline: (
    task: string,
    model: string,
    opts?: Record<string, unknown>
  ) => Promise<unknown>;
};

let loaderPromise: Promise<Loader | null> | null = null;

/** Lazily import Transformers.js so it never enters the main bundle. */
async function loadLibrary(): Promise<Loader | null> {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      try {
        const mod = (await import(
          "@huggingface/transformers"
        )) as unknown as Loader;
        mod.env.allowLocalModels = false;
        mod.env.allowRemoteModels = true;
        mod.env.useBrowserCache = true;
        return mod;
      } catch {
        return null;
      }
    })();
  }
  return loaderPromise;
}

type Entry = { promise: Promise<unknown>; sizeMb: number; lastUsed: number };
const cache = new Map<string, Entry>();

function loadedMb(): number {
  let total = 0;
  for (const e of cache.values()) total += e.sizeMb;
  return total;
}

/** Cache statistics for the status UI and capability telemetry. No PII. */
export function cacheStats(): {
  models: number;
  estimatedMb: number;
  capMb: number;
} {
  return {
    models: cache.size,
    estimatedMb: loadedMb(),
    capMb: CACHE_BUDGETS.capMb,
  };
}

export type PipelineOptions = {
  /** Force a backend/precision (defaults to the device tier). */
  device?: "webgpu" | "wasm";
  dtype?: Dtype;
  onProgress?: PipelineProgress;
  /** Cancel a queued load. Inference itself is synchronous once loaded. */
  signal?: AbortSignal;
  /** Bypass the registry budget gate (warm-up of an opt-in model). */
  allowOverBudget?: boolean;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ModelUnavailable("cancelled", "Pipeline load cancelled");
}

/**
 * Get (or create) a cached pipeline. Resolves to null when the library or the
 * model is unavailable — callers must degrade gracefully, never throw — except
 * cancellation and budget/offline refusals, which reject with ModelUnavailable
 * so the UI can distinguish "cancelled" from "failed".
 */
export async function getPipeline(
  task: string,
  model: string,
  opts: PipelineOptions = {}
): Promise<unknown> {
  const caps = detectCapabilities();
  const device = opts.device ?? caps.device;
  const dtype = opts.dtype ?? caps.dtype;
  const key = task + "|" + model + "|" + device + "|" + dtype;

  const existing = cache.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    throwIfAborted(opts.signal);
    return existing.promise;
  }

  throwIfAborted(opts.signal);
  const sizeMb = modelSizeMb(model);
  if (!opts.allowOverBudget && !canAfford(caps, sizeMb)) {
    throw new ModelUnavailable(
      "budget",
      "Model " + model + " exceeds this device’s budget"
    );
  }
  if (loadedMb() + sizeMb > CACHE_BUDGETS.capMb) {
    evictIdle(1);
    if (loadedMb() + sizeMb > CACHE_BUDGETS.capMb) {
      throw new ModelUnavailable(
        "budget",
        "Model cache budget exceeded — evict a model first"
      );
    }
  }
  const online =
    globalThis.navigator !== undefined ? navigator.onLine !== false : true;
  if (!online) {
    throw new ModelUnavailable(
      "offline",
      "Offline and model is not cached yet"
    );
  }

  const created = (async () => {
    throwIfAborted(opts.signal);
    const mod = await loadLibrary();
    if (!mod) return null;
    throwIfAborted(opts.signal);
    try {
      return await mod.pipeline(task, model, {
        device,
        dtype,
        progress_callback: (info: {
          status?: string;
          progress?: number;
          file?: string;
        }) => {
          if (!opts.onProgress) return;
          if (info.status === "progress") {
            opts.onProgress({
              status: "downloading",
              progress: Math.round(info.progress ?? 0),
              file: info.file,
            });
          } else if (info.status === "ready") {
            opts.onProgress({ status: "ready", progress: 100 });
          }
        },
      });
    } catch {
      // WebGPU can fail on some drivers — retry once on WASM before giving up.
      if (device === "webgpu") {
        try {
          return await mod.pipeline(task, model, {
            device: "wasm",
            dtype: "q8",
          });
        } catch {
          return null;
        }
      }
      opts.onProgress?.({ status: "error", progress: 0 });
      return null;
    }
  })();

  cache.set(key, { promise: created, sizeMb, lastUsed: Date.now() });
  try {
    return await created;
  } catch (err) {
    // Failed loads must not poison the cache.
    if (cache.get(key)?.promise === created) cache.delete(key);
    throw err;
  }
}

/**
 * Warm-up: preload a model during idle so the first real call is fast.
 * Fire-and-forget; resolves false (never rejects) when warming is impossible.
 */
export async function warmModel(
  task: string,
  model: string,
  opts: PipelineOptions = {}
): Promise<boolean> {
  try {
    const pipe = await getPipeline(task, model, opts);
    return pipe !== null;
  } catch {
    return false;
  }
}

/** Evict idle pipelines LRU-first. Returns the number evicted. */
export function evictIdle(max = Infinity): number {
  const ordered = [...cache.entries()].sort(
    (a, b) => a[1].lastUsed - b[1].lastUsed
  );
  let n = 0;
  for (const [key] of ordered) {
    if (n >= max) break;
    cache.delete(key);
    n++;
  }
  return n;
}

/** Evict every cached pipeline for one model id. Best-effort, never throws. */
export function evictModel(model: string): number {
  let n = 0;
  for (const key of [...cache.keys()]) {
    if (key.split("|")[1] === model) {
      cache.delete(key);
      n++;
    }
  }
  return n;
}

/** Drop all cached pipelines (memory pressure / sign-out). Never throws. */
export function evictAll(): number {
  const n = cache.size;
  cache.clear();
  return n;
}

/**
 * CacheStorage bucket the Transformers.js loader persists weights in
 * (useBrowserCache true - WebLLM caching pattern). Survives reloads and
 * restarts; the service worker and the dev teardown must both preserve it.
 */
export const TRANSFORMERS_CACHE_KEY = "transformers-cache";

/**
 * Best-effort probe: is ANY weight file for this model id already persisted
 * in CacheStorage? True means a warm-up (or inference) can skip the download
 * entirely - the proof behind second-visit-from-cache. Never throws;
 * false in runtimes without CacheStorage (SSR, old browsers, tests).
 */
export async function isModelCached(modelId: string): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    if (!modelId) return false;
    const keys = await caches.keys();
    for (const key of keys) {
      if (!key.toLowerCase().includes("transform")) continue;
      const bucket = await caches.open(key);
      const entries = await bucket.keys();
      for (const req of entries) {
        const url = typeof req.url === "string" ? req.url : "";
        if (url && url.includes(modelId)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Whether the browser AI runtime can load at all on this device. */
export function browserAiAvailable(): boolean {
  const caps = detectCapabilities();
  return caps.wasm || caps.webgpu;
}
