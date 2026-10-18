/**
 * Automation-scope idempotency — replay-safe enqueue for the durable queue.
 *
 * The atomic claim primitive lives in `@/lib/idempotency` (`claimIdempotencyKey`
 * over the `IdempotencyKey` table — the uniqueness constraint IS the claim, so
 * there is exactly one winner and no check-then-act race). This module only
 * adds the queue's key namespace plus a claim helper, so every automation-job
 * path converges on one reservation format:
 * `automation-job:<topic>:<dedupeKey>`.
 *
 * Pure key builder + thin claim wrapper; no duplicate primitives.
 */

// No top-level Prisma imports: the claim primitive is lazy-loaded so the key
// builder stays dependency-free (repo convention: unit specs import only
// Prisma-free modules).

/** Canonical dedupe key for one automation-job enqueue. */
export function jobDedupeKeyFor(topic: string, dedupeKey: string): string {
  return `automation-job:${topic}:${dedupeKey}`;
}

/**
 * Claim a job dedupe key exactly once. The winner enqueues; a loser replays
 * (returns the winner's recorded job id when one was stored, else null so the
 * caller can look the in-flight job up by correlation instead of duplicating).
 */
export async function claimJobDedupeKey(
  topic: string,
  dedupeKey: string,
): Promise<{ won: boolean; existingRef: string | null }> {
  const { claimIdempotencyKey } = await import("@/lib/idempotency");
  const { won, existingRef } = await claimIdempotencyKey(jobDedupeKeyFor(topic, dedupeKey), "automation-job");
  return { won, existingRef };
}
