"use client";
/**
 * Device capability probe for the browser AI stack.
 *
 * Everything here runs on the user's device. We classify the machine into a
 * performance *tier* so each model picks the best backend + precision it can
 * actually run:
 *   · high   → WebGPU, fp16 (best quality + speed)
 *   · medium → WebGPU q8, or WASM with threads
 *   · low    → WASM q4 (smallest, slowest — still local)
 */

export type Tier = "high" | "medium" | "low";
export type Dtype = "fp32" | "fp16" | "q8" | "q4";

export type Capabilities = {
  webgpu: boolean;
  wasm: boolean;
  threads: boolean;
  /** navigator.hardwareConcurrency (logical cores), 0 when unknown. */
  cores: number;
  /** navigator.deviceMemory (GB, Chrome), null when unknown. */
  memoryGb: number | null;
  tier: Tier;
  /** Precision Transformers.js should use for this device. */
  dtype: Dtype;
  /** Backend Transformers.js should use for this device. */
  device: "webgpu" | "wasm";
  /** Effective network state at probe time (false = offline-degraded mode). */
  online: boolean;
  /** Working-memory budget for model weights on this tier (MB). */
  memBudgetMb: number;
};

let cached: Capabilities | null = null;

export function detectCapabilities(): Capabilities {
  if (cached) return cached;

  const nav =
    globalThis.navigator !== undefined
      ? (navigator as Navigator & { gpu?: unknown; deviceMemory?: number })
      : null;
  const webgpu = Boolean(nav?.gpu);
  const wasm = typeof WebAssembly === "object";
  const threads = typeof SharedArrayBuffer !== "undefined" && wasm;
  const cores = nav?.hardwareConcurrency ?? 0;
  const memoryGb =
    typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null;

  const strong = cores >= 8 && (memoryGb === null || memoryGb >= 8);
  const weak = cores > 0 && cores <= 2;

  let tier: Tier = "medium";
  if (webgpu && strong) tier = "high";
  else if (weak || (!webgpu && !threads)) tier = "low";

  const device: Capabilities["device"] = webgpu ? "webgpu" : "wasm";
  const dtype: Dtype =
    tier === "high" ? "fp16" : tier === "medium" ? "q8" : "q4";
  const online =
    globalThis.navigator !== undefined ? navigator.onLine !== false : true;
  const memBudgetMb = tier === "high" ? 1024 : tier === "medium" ? 512 : 256;

  cached = {
    webgpu,
    wasm,
    threads,
    cores,
    memoryGb,
    tier,
    dtype,
    device,
    online,
    memBudgetMb,
  };
  return cached;
}

/** Size/memory budget check: may this tier load a model of sizeMb? */
export function canAfford(
  c: Capabilities,
  sizeMb: number,
  memoryMb = 0
): boolean {
  if (sizeMb <= 0) return true;
  const max = c.tier === "high" ? 700 : c.tier === "medium" ? 650 : 250;
  if (sizeMb > max) return false;
  if (memoryMb > 0 && memoryMb > c.memBudgetMb) return false;
  return true;
}

/** Re-probe network state (tiers are cached; online is not). */
export function refreshOnlineState(): boolean {
  const online =
    globalThis.navigator !== undefined ? navigator.onLine !== false : true;
  const c = detectCapabilities();
  c.online = online;
  return online;
}
