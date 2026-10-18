/**
 * Case Event Ledger — append-only, hash-chained (spec §2 / AGENTS.md R2).
 *
 * Every consequential case mutation appends exactly one row.
 * hash = sha256(prevHash + payload + occurredAt)
 * prevHash = null only for the case's genesis event.
 * Rows are never updated or deleted — corrections are new events.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";

export interface LedgerEvent {
  id: string;
  caseId: string;
  topic: string;
  payload: string;
  occurredAt: Date;
  prevHash: string | null;
  hash: string;
  actorId: string | null;
  actorLabel: string | null;
  correlationId: string | null;
}

export interface AppendResult {
  event: LedgerEvent;
  isGenesis: boolean;
}

export interface ChainVerification {
  ok: boolean;
  caseId: string | null;
  checked: number;
  mismatches: Array<{
    id: string;
    expected: string;
    actual: string;
    index: number;
  }>;
}

/**
 * Compute the chain hash: sha256(prevHash + payload + occurredAtISO)
 * Uses a null byte separator for prevHash when it's null (genesis).
 */
function computeHash(prevHash: string | null, payload: string, occurredAt: Date): string {
  const parts = [
    prevHash ?? "\u0000", // null byte for genesis
    payload,
    occurredAt.toISOString(),
  ];
  return createHash("sha256").update(parts.join("")).digest("hex");
}

/**
 * Get the latest event for a case (by occurredAt) to chain from.
 */
async function getLatestEvent(caseId: string): Promise<{ hash: string; occurredAt: Date } | null> {
  const row = await db.caseEvent.findFirst({
    where: { caseId },
    orderBy: { occurredAt: "desc" },
    select: { hash: true, occurredAt: true },
  });
  if (!row) return null;
  return { hash: row.hash, occurredAt: row.occurredAt };
}

/**
 * Append a new event to the case's hash chain.
 * Always throws on failure — on failure, callers halt (throws) and emit INTEGRITY_ALERT.
 */
export async function appendEvent(params: {
  caseId: string;
  topic: string;
  payload: Record<string, unknown>;
  actorId?: string | null;
  actorLabel?: string | null;
  correlationId?: string | null;
}): Promise<AppendResult> {
  try {
    const occurredAt = new Date();
    const payloadStr = JSON.stringify(params.payload);
    const latest = await getLatestEvent(params.caseId);
    const prevHash = latest?.hash ?? null;
    const hash = computeHash(prevHash, payloadStr, occurredAt);

    const event = await db.caseEvent.create({
      data: {
        caseId: params.caseId,
        topic: params.topic,
        payload: payloadStr,
        occurredAt,
        prevHash,
        hash,
        actorId: params.actorId ?? null,
        actorLabel: params.actorLabel ?? null,
        correlationId: params.correlationId ?? null,
      },
    });

    return {
      event: {
        id: event.id,
        caseId: event.caseId,
        topic: event.topic,
        payload: event.payload,
        occurredAt: event.occurredAt,
        prevHash: event.prevHash,
        hash: event.hash,
        actorId: event.actorId,
        actorLabel: event.actorLabel,
        correlationId: event.correlationId,
      },
      isGenesis: prevHash === null,
    };
  } catch (err) {
    // R2 integrity: a ledger write that fails SILENTLY (null) lets the
    // mutation report success while the chain is broken — downstream trust
    // (integrity badge, audit-bundle) then attests to history that was never
    // chained. Fail LOUD: callers halt and emit INTEGRITY_ALERT.
    console.error("[case-ledger] appendEvent failed", err);
    throw new DomainError("Case ledger append failed — event halted", 500, { cause: err });
  }
}

/**
 * Verify the integrity of a case's event chain.
 * If caseId is omitted, verifies ALL cases (expensive — admin only).
 */
export async function verifyChain(caseId?: string): Promise<ChainVerification> {
  const mismatches: ChainVerification["mismatches"] = [];
  let checked = 0;

  const caseIds = caseId
    ? [caseId]
    : (await db.case.findMany({ select: { id: true } })).map((c) => c.id);

    for (const cid of caseIds) {
      const events = await db.caseEvent.findMany({
        where: { caseId: cid },
        orderBy: { occurredAt: "asc" },
      });

      let expectedPrevHash: string | null = null;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        checked++;
        const computed = computeHash(expectedPrevHash, e.payload, e.occurredAt);
        // Constant-time comparison: a chain-integrity check must not leak how
        // much of the stored hash matched through response timing.
        const matches =
          computed.length === e.hash.length && timingSafeEqual(Buffer.from(computed), Buffer.from(e.hash));
        if (!matches) {
          mismatches.push({
            id: e.id,
            expected: computed,
            actual: e.hash,
            index: i,
          });
        }
        expectedPrevHash = e.hash;
      }
    }

    return {
      ok: mismatches.length === 0,
      caseId: caseId ?? null,
      checked,
      mismatches,
    };
}

/**
 * Get all events for a case (for audit-bundle export).
 */
export async function getCaseEvents(caseId: string): Promise<LedgerEvent[]> {
  const rows = await db.caseEvent.findMany({
    where: { caseId },
    orderBy: { occurredAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    caseId: r.caseId,
    topic: r.topic,
    payload: r.payload,
    occurredAt: r.occurredAt,
    prevHash: r.prevHash,
    hash: r.hash,
    actorId: r.actorId,
    actorLabel: r.actorLabel,
    correlationId: r.correlationId,
  }));
}

/**
 * Get the head hash of a case's chain (for quick integrity badge checks).
 */
export async function getHeadHash(caseId: string): Promise<string | null> {
  const latest = await getLatestEvent(caseId);
  return latest?.hash ?? null;
}

/**
 * Count events in a case's chain.
 */
export async function getEventCount(caseId: string): Promise<number> {
  return db.caseEvent.count({ where: { caseId } });
}