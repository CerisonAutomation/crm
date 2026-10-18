/**
 * RFI use cases — pure orchestration over the injected RfiStore port (ADR-004).
 *
 * Prisma-free: routes supply the Prisma-backed store (composition root in
 * src/lib/adapters/prisma-rfi-store.ts); specs inject the in-memory fake.
 * Every turn and every transition records one audit entry — an RFI answer
 * with no audit row is a defect, asserted in tests/rfi-turns.test.ts.
 */
import { DomainError } from "@/lib/domain/states";
import {
  RFI_DEFAULT_SLA_HOURS,
  assertCaseAcceptsRfi,
  assertRfiTransition,
  authorisationForTurn,
  isSlaBreached,
  slaDueAt,
  statusAfterTurn,
  validateNewThread,
  validateNewTurn,
} from "@/lib/domain/rfi";
import type { RfiStatus, RfiThread, RfiTurn, RfiTurnKind } from "@/lib/domain/rfi";
import type { PersistedThread, PersistedTurn, RfiAudit, RfiCaseContext, RfiStore } from "@/lib/ports/rfi";

export type RfiActor = {
  id: string;
  role: string;
  label: string;
};

export type RfiDeps = {
  store: RfiStore;
  audit: RfiAudit;
  now?: () => Date;
};

function toTurn(t: PersistedTurn): RfiTurn {
  return {
    id: t.id,
    threadId: t.threadId,
    kind: t.kind,
    body: t.body,
    authorId: t.authorId,
    authorRole: t.authorRole,
    authorLabel: t.authorLabel,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
  };
}

export function toThread(t: PersistedThread): RfiThread {
  return {
    id: t.id,
    orgId: t.orgId,
    caseId: t.caseId,
    subject: t.subject,
    status: t.status,
    ownerId: t.ownerId,
    documentRequestId: t.documentRequestId,
    slaDueAt: t.slaDueAt ? (t.slaDueAt instanceof Date ? t.slaDueAt.toISOString() : String(t.slaDueAt)) : null,
    slaHours: t.slaHours,
    createdBy: t.createdBy,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
    turns: t.turns.map(toTurn),
  };
}

function auditTarget(caseId: string, threadId: string): string {
  return "case:" + caseId + "/rfi:" + threadId;
}

/**
 * Staff opens a thread: validates unhappy-first, checks the case accepts RFI,
 * authorises OPEN, arms the first SLA clock, writes the opening QUESTION and
 * audit-logs the open. The owner defaults to the case RM (accountability is
 * never nobody — the Tuesday-status-call dies here).
 */
export async function openRfiThread(
  deps: RfiDeps,
  kase: RfiCaseContext,
  actor: RfiActor,
  input: { subject: unknown; body: unknown; documentRequestId?: unknown; slaHours?: unknown; ownerId?: unknown },
  correlationId?: string,
): Promise<RfiThread> {
  const errors = validateNewThread(input);
  if (errors.length > 0) throw new DomainError("Invalid RFI thread: " + errors.join("; "), 400);
  const denied = authorisationForTurn(actor.role, "OPEN", false);
  if (denied) throw new DomainError("Forbidden — " + denied, 403);
  assertCaseAcceptsRfi(kase.status);
  const now = (deps.now ?? (() => new Date()))();
  const slaHours = typeof input.slaHours === "number" ? input.slaHours : RFI_DEFAULT_SLA_HOURS;
  const subject = String(input.subject).trim().slice(0, 160);
  const body = String(input.body).trim().slice(0, 4000);
  const documentRequestId =
    typeof input.documentRequestId === "string" ? input.documentRequestId : null;
  const ownerId =
    typeof input.ownerId === "string" && input.ownerId.trim() !== ""
      ? input.ownerId.trim()
      : kase.rmAssignedId;
  const persisted = await deps.store.openThread({
    orgId: kase.orgId,
    caseId: kase.id,
    subject,
    status: "OPEN",
    ownerId,
    documentRequestId,
    slaDueAt: new Date(slaDueAt(now, slaHours)),
    slaHours,
    createdBy: actor.id,
    openingTurn: { kind: "QUESTION", body, authorId: actor.id, authorRole: actor.role, authorLabel: actor.label },
  });
  await deps.audit.record({
    orgId: kase.orgId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: "rfi.thread.opened",
    target: auditTarget(kase.id, persisted.id),
    reason: subject,
    correlationId,
  });
  return toThread(persisted);
}
/**
 * Append a turn: validates, loads the thread tenant-scoped, authorises the
 * kind for this actor (clients answer own threads only), advances the status
 * through the domain transition table, re-arms (QUESTION) or disarms (ANSWER)
 * the SLA clock, and audit-logs the turn. CLOSED threads and closed cases
 * reject every turn.
 */
export async function appendRfiTurn(
  deps: RfiDeps,
  kase: RfiCaseContext,
  actor: RfiActor,
  threadId: string,
  input: { kind: unknown; body: unknown },
  correlationId?: string,
): Promise<RfiThread> {
  const errors = validateNewTurn(input);
  if (errors.length > 0) throw new DomainError("Invalid RFI turn: " + errors.join("; "), 400);
  const kind = input.kind as RfiTurnKind;
  const denied = authorisationForTurn(actor.role, kind, kase.clientId === actor.id);
  if (denied) throw new DomainError("Forbidden — " + denied, 403);
  assertCaseAcceptsRfi(kase.status);
  const existing = await deps.store.threadById(kase.orgId, threadId);
  if (!existing || existing.caseId !== kase.id) throw new DomainError("RFI thread not found", 404);
  if (existing.status === "CLOSED") throw new DomainError("This RFI thread is closed", 409);
  const now = (deps.now ?? (() => new Date()))();
  const nextStatus = statusAfterTurn(existing.status, kind);
  const body = String(input.body).trim().slice(0, 4000);
  const nextSlaDueAt =
    kind === "QUESTION"
      ? new Date(slaDueAt(now, existing.slaHours))
      : kind === "ANSWER"
        ? null
        : ("UNCHANGED" as const);
  const persisted = await deps.store.appendTurn(threadId, {
    kind,
    body,
    authorId: actor.id,
    authorRole: actor.role,
    authorLabel: actor.label,
    nextStatus,
    nextSlaDueAt,
  });
  await deps.audit.record({
    orgId: kase.orgId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: "rfi.turn.recorded",
    target: auditTarget(kase.id, persisted.id),
    reason: kind + ": " + body.slice(0, 120),
    correlationId,
  });
  return toThread(persisted);
}

/**
 * Staff closes a thread once the answer resolves the chase. Closing is a
 * transition (OPEN/ANSWERED/ESCALATED -> CLOSED) with a SYSTEM turn and an
 * audit row — the record stays readable after the chase ends.
 */
export async function closeRfiThread(
  deps: RfiDeps,
  kase: RfiCaseContext,
  actor: RfiActor,
  threadId: string,
  correlationId?: string,
): Promise<RfiThread> {
  const denied = authorisationForTurn(actor.role, "CLOSE", false);
  if (denied) throw new DomainError("Forbidden — " + denied, 403);
  const existing = await deps.store.threadById(kase.orgId, threadId);
  if (!existing || existing.caseId !== kase.id) throw new DomainError("RFI thread not found", 404);
  assertRfiTransition(existing.status, "CLOSED");
  const persisted = await deps.store.setStatus(threadId, "CLOSED", "Thread closed by " + actor.label + ".");
  await deps.audit.record({
    orgId: kase.orgId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: "rfi.thread.closed",
    target: auditTarget(kase.id, persisted.id),
    correlationId,
  });
  return toThread(persisted);
}

/**
 * Staff manually escalates a thread (chase is stuck, Tuesday call looms).
 * Same landing as the runner path — one flag, two doors.
 */
export async function escalateRfiThread(
  deps: RfiDeps,
  kase: RfiCaseContext,
  actor: RfiActor,
  threadId: string,
  correlationId?: string,
): Promise<RfiThread> {
  const denied = authorisationForTurn(actor.role, "ESCALATE", false);
  if (denied) throw new DomainError("Forbidden — " + denied, 403);
  const existing = await deps.store.threadById(kase.orgId, threadId);
  if (!existing || existing.caseId !== kase.id) throw new DomainError("RFI thread not found", 404);
  assertRfiTransition(existing.status, "ESCALATED");
  const persisted = await deps.store.setStatus(threadId, "ESCALATED", "Manually escalated by " + actor.label + ".");
  await deps.audit.record({
    orgId: kase.orgId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: "rfi.thread.escalated",
    target: auditTarget(kase.id, persisted.id),
    reason: "manual escalation",
    correlationId,
  });
  return toThread(persisted);
}

/**
 * Deadline-runner escalation: every OPEN thread past its SLA becomes
 * ESCALATED with a SYSTEM turn (overdue hours recorded) plus an audit row.
 * The caller (reminders sweep) owns notification — this function only moves
 * the state machine and the record. Idempotent per thread: already-escalated
 * rows never appear in the overdue feed.
 */
export async function escalateOverdueThreads(
  deps: RfiDeps,
  correlationId?: string,
): Promise<Array<{ threadId: string; caseId: string; orgId: string; ownerId: string | null }>> {
  const now = (deps.now ?? (() => new Date()))();
  const overdue = await deps.store.overdueOpenThreads(now, 50);
  const escalated: Array<{ threadId: string; caseId: string; orgId: string; ownerId: string | null }> = [];
  for (const thread of overdue) {
    if (!isSlaBreached({ status: thread.status, slaDueAt: thread.slaDueAt ? thread.slaDueAt.toISOString() : null }, now)) {
      continue;
    }
    const dueMs = thread.slaDueAt ? thread.slaDueAt.getTime() : now.getTime();
    const hours = Math.max(0, Math.floor((now.getTime() - dueMs) / 3600000));
    const persisted = await deps.store.setStatus(
      thread.id,
      "ESCALATED",
      "SLA breached by " + String(hours) + "h — escalated to the RM queue.",
    );
    await deps.audit.record({
      orgId: thread.orgId,
      actorId: null,
      actorLabel: "Reminder engine",
      action: "rfi.thread.escalated",
      target: auditTarget(thread.caseId, thread.id),
      reason: "SLA breached by " + String(hours) + "h",
      correlationId,
    });
    escalated.push({ threadId: persisted.id, caseId: persisted.caseId, orgId: persisted.orgId, ownerId: persisted.ownerId });
  }
  return escalated;
}

export type { RfiStatus, RfiThread, RfiTurn, RfiTurnKind };


