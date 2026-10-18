"use client";
/**
 * Product telemetry (client) — batched view / event / api signals.
 *
 * Contract: telemetry must NEVER break the app. Every path is best-effort,
 * nothing throws, and the queue flushes on a timer plus on page-hide (via
 * sendBeacon so it survives navigation). Errors are reported separately by
 * src/lib/errors.ts; this module covers product usage.
 */
import { ensureSessionId } from "@/lib/errors";

type Kind = "view" | "event" | "api";
type TrackedEvent = {
  kind: Kind;
  name: string;
  view?: string;
  path?: string;
  role?: string;
  locale?: string;
  props?: Record<string, unknown>;
  durationMs?: number;
  status?: number;
};

const MAX_QUEUE = 20;
const FLUSH_MS = 4000;

let queue: TrackedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let wired = false;

function flush(useBeacon = false): void {
  if (typeof window === "undefined" || queue.length === 0) return;
  const events = queue.splice(0, MAX_QUEUE).map((e) => ({ ...e, sessionId: ensureSessionId() }));
  const body = JSON.stringify({ events });
  try {
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}

function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

function enqueue(e: TrackedEvent): void {
  if (typeof window === "undefined") return;
  wire();
  queue.push(e);
  if (queue.length >= MAX_QUEUE) {
    flush();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
  }
}

const pagePath = () => (typeof window === "undefined" ? undefined : window.location.pathname);

/** A navigation / view change. */
export function trackView(view: string, opts?: { role?: string; locale?: string }): void {
  enqueue({ kind: "view", name: view, view, path: pagePath(), ...opts });
}

/** A product interaction (button click, flow milestone, …). */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  enqueue({ kind: "event", name, path: pagePath(), props });
}

/** An API call outcome (used for latency + failure visibility). */
export function trackApi(name: string, status: number, durationMs?: number): void {
  enqueue({ kind: "api", name, path: pagePath(), status, durationMs });
}

/** Flush immediately (e.g. before a hard navigation). */
export function flushTelemetry(): void {
  flush();
}
