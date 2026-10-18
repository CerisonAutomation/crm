"use client";
/**
 * Browser-AI capability telemetry — performance + availability signals only.
 *
 * PRIVACY CONTRACT (E17): events carry tier/device/dtype buckets, task, model
 * id, latency and outcome. They NEVER carry user text, transcripts, prompts,
 * user ids, case ids, IP-derived data or user-agent strings. Cores and memory
 * are bucketed so a report cannot fingerprint a device. Every path is
 * best-effort and never throws; reporting must never break the feature.
 */
import { detectCapabilities } from "./capabilities";

export type TelemetryOutcome = "ok" | "degraded" | "failed" | "cancelled" | "evicted";

export type CapabilityTelemetry = {
  tier: string;
  device: string;
  dtype: string;
  coresBucket: "unknown" | "le2" | "le4" | "le8" | "gt8";
  memBucket: "unknown" | "le4" | "le8" | "gt8";
  task: string;
  model: string;
  latencyMs: number;
  outcome: TelemetryOutcome;
  reason?: string;
};

function bucketCores(cores: number): CapabilityTelemetry["coresBucket"] {
  if (!cores || cores <= 0) return "unknown";
  if (cores <= 2) return "le2";
  if (cores <= 4) return "le4";
  if (cores <= 8) return "le8";
  return "gt8";
}

function bucketMem(mem: number | null): CapabilityTelemetry["memBucket"] {
  if (mem === null || mem === undefined) return "unknown";
  if (mem <= 4) return "le4";
  if (mem <= 8) return "le8";
  return "gt8";
}

/** Record one capability event. Strips everything except buckets + outcome. */
export function recordCapability(e: {
  task: string;
  model: string;
  latencyMs: number;
  outcome: TelemetryOutcome;
  reason?: string;
}): void {
  if (typeof window === "undefined") return;
  try {
    const c = detectCapabilities();
    const event: CapabilityTelemetry = {
      tier: c.tier,
      device: c.device,
      dtype: c.dtype,
      coresBucket: bucketCores(c.cores),
      memBucket: bucketMem(c.memoryGb),
      task: String(e.task).slice(0, 40),
      model: String(e.model).slice(0, 120),
      latencyMs: Math.max(0, Math.round(e.latencyMs)),
      outcome: e.outcome,
      reason: e.reason ? String(e.reason).slice(0, 120) : undefined,
    };
    void import("@/lib/telemetry/client")
      .then((m) => m.trackEvent("browser-ai", event as unknown as Record<string, unknown>))
      .catch(() => undefined);
  } catch {
    /* telemetry never throws */
  }
}
