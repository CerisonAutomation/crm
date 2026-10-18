/**
 * Minimal in-memory fixed-window rate limiter (CONSOLIDATED 2026-10-06).
 * Single-instance only — sufficient for the public lead-intake endpoint.
 * Behind multiple instances, put a real gateway limit in front.
 */

type Bucket = { hits: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();
/** Hard cap — last line of defence against key-flooding. */
let MAX_BUCKETS = 5_000;
/** Test-only override for the hard cap. */
export function __setCapForTesting(n: number): void {
  MAX_BUCKETS = n;
}
/** Lazy sweep runs at most once per minute, from inside hit(). */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

// The Map lives in ONE process's memory, so behind multiple instances (a
// serverless platform or a load-balanced fleet) each instance keeps its own
// counters and the effective limit multiplies. Warn once at boot so a
// production deployment is never silently under-protected.
if (process.env.NODE_ENV === "production") {
  console.warn(
    "[security] The in-memory rate limiter is single-instance only. " +
      "Behind multiple instances (serverless, load-balanced), put a real gateway limit in front."
  );
}

export function hit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  // Lazy sweep: drop every bucket whose hits have all aged out of its own window.
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    for (const [k, bucket] of buckets) {
      const alive = bucket.hits.filter((t) => now - t < bucket.windowMs);
      if (alive.length === 0) buckets.delete(k);
      else bucket.hits = alive;
    }
  }
  // Hard cap: evict least-recently-used keys (LRU) so an attacker flooding
  // unique keys cannot evict a legitimate high-volume tenant from its bucket.
  // The Map preserves insertion order; touched buckets are re-inserted at the
  // tail (most-recently-used), so the head is always the LRU.
  while (buckets.size > MAX_BUCKETS) {
    const lru = buckets.keys().next().value;
    if (lru === undefined) break;
    buckets.delete(lru);
  }
  const bucket = buckets.get(key);
  const arr = (bucket?.hits ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const oldest = arr[0] ?? now;
    if (bucket) {
      bucket.hits = arr;
      buckets.delete(key);
      buckets.set(key, bucket);
    }
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  arr.push(now);
  if (bucket) {
    bucket.hits = arr;
    bucket.windowMs = windowMs;
    buckets.delete(key);
    buckets.set(key, bucket);
  } else {
    buckets.set(key, { hits: arr, windowMs });
  }
  return { allowed: true, retryAfterSec: 0 };
}
