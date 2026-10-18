/**
 * Idempotency key management (C9 / R3).
 *
 * Backed by the `IdempotencyKey` table (key @id — the uniqueness constraint
 * IS the atomic claim). Two scopes share the table by key prefix:
 *   - "http" (via recordIdempotencyKey/getIdempotencyKey): request
 *     fingerprints with their JSON response stored in `resultRef`;
 *   - "workflow-run" / "workflow-node" / "event-hub": reservation keys whose
 *     `resultRef` points at the created run/row (claimed inline by the
 *     engines, which need transactional coupling — see workflow-engine and
 *     event-hub; the per-step claim helper below is the shared primitive).
 * Foreign rows (other scopes) are treated as opaque reservations, never as
 * HTTP responses.
 */

import { createHash } from "node:crypto";
import { db } from "./db";

/**
 * Compute a fingerprint for a request.
 */
export function fingerprintRequest(method: string, path: string, body: unknown): string {
  const data = JSON.stringify({ method, path, body });
  return createHash("sha256").update(data).digest("hex");
}

/** Completed-record shape returned for a previously recorded key. */
export interface IdempotencyRecord {
  status: "completed";
  response: unknown;
  resultRef: string | null;
}

/**
 * Check if an idempotency key has been used before. Returns the completed
 * record (with its stored response) or null when the key is unknown or
 * still in flight (reservation without a result). Never swallows a DB
 * failure — an idempotency check that cannot read must fail loud, never
 * "no duplicate" by default.
 */
export async function getIdempotencyRecord(
  key: string,
): Promise<IdempotencyRecord | null> {
  const row = await db.idempotencyKey.findUnique({ where: { key } });
  if (!row || !row.resultRef) return null;
  let response: unknown;
  try {
    const parsed = JSON.parse(row.resultRef) as { response?: unknown };
    response =
      typeof parsed === "object" && parsed !== null && "response" in parsed
        ? parsed.response
        : { ref: row.resultRef };
  } catch {
    // Foreign scope (run id / outbox id reservation) — opaque, not an HTTP body.
    response = { ref: row.resultRef };
  }
  return { status: "completed", response, resultRef: row.resultRef };
}

/**
 * Record an idempotency key with its response. Creates the reservation, or —
 * when a concurrent request won the race — refreshes the winner's result.
 * Throws on DB failure (a response that cannot be recorded must not be
 * reported as recorded).
 */
export async function recordIdempotencyKey(
  key: string,
  response: unknown,
  scope = "http",
): Promise<void> {
  const resultRef = JSON.stringify({ response });
  try {
    await db.idempotencyKey.create({ data: { key, scope, resultRef } });
  } catch {
    await db.idempotencyKey.update({ where: { key }, data: { resultRef } });
  }
}

/**
 * Atomic claim-or-observe for one idempotency key. The table's @id
 * uniqueness makes the create the single winner; losers observe the
 * winner's reservation instead of re-executing the effect.
 */
export async function claimIdempotencyKey(
  key: string,
  scope = "http",
): Promise<{ won: boolean; existingRef: string | null }> {
  try {
    await db.idempotencyKey.create({ data: { key, scope } });
    return { won: true, existingRef: null };
  } catch {
    const row = await db.idempotencyKey
      .findUnique({ where: { key }, select: { resultRef: true } })
      .catch(() => null);
    return { won: false, existingRef: row?.resultRef ?? null };
  }
}

/**
 * Record the winner for an existing reservation (heal a claim that has no
 * result yet, e.g. crash between claim and record). Updates when the row
 * exists, creates it when it does not; a concurrent unique-conflict (P2002)
 * means the result was recorded first — benign. Any other DB failure throws
 * loud: a winner that cannot be recorded must not be reported as recorded.
 */
export async function resolveIdempotencyKey(
  key: string,
  resultRef: string,
  scope = "http",
): Promise<void> {
  try {
    await db.idempotencyKey.update({ where: { key }, data: { resultRef } });
    return;
  } catch {
    // Missing row — fall through to create.
  }
  try {
    await db.idempotencyKey.create({ data: { key, scope, resultRef } });
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
  }
}

/**
 * Per-step claim for the workflow engine (R3): exactly one execution owns
 * the effect for a (runId, nodeKey) step. Key format is canonical here so
 * every step path converges on one reservation.
 */
export function stepKeyFor(runId: string, nodeKey: string): string {
  return `workflow-node:${runId}:${nodeKey}`;
}

export async function claimStepKey(
  runId: string,
  nodeKey: string,
): Promise<{ won: boolean; existingRef: string | null }> {
  return claimIdempotencyKey(stepKeyFor(runId, nodeKey), "workflow-node");
}

/**
 * Require an idempotency key for mutating operations.
 */
export function requireIdempotencyKey(headers: Headers): string | null {
  return headers.get("idempotency-key");
}
