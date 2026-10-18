/**
 * Decision tracking service (Zenith blueprint §9 — Decision entity).
 *
 * Tracks AI and human decisions for audit and compliance.
 */

import { db } from "../db";
import { notFound } from "../api-errors";
import { DomainError } from "@/lib/domain/states";

export interface Decision {
  id: string;
  orgId: string;
  caseId: string | null;
  type: string;
  status: string;
  decision: string | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  appealOf: string | null;
  version: number;
  appellantId: string | null;
  appealReason: string | null;
  appealExpiresAt: Date | null;
  appealStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create a new decision record.
 */
export async function createDecision(params: {
  orgId: string;
  caseId?: string;
  type: string;
  decision?: string;
  reason?: string;
}): Promise<Decision> {
  return db.decision.create({
    data: {
      orgId: params.orgId,
      caseId: params.caseId ?? null,
      type: params.type,
      status: "PENDING",
      decision: params.decision ?? null,
      reason: params.reason ?? null,
    },
  });
}

/**
 * Get decisions for an organisation, optionally filtered by case.
 */
export async function getDecisions(
  orgId: string,
  caseId?: string
): Promise<Decision[]> {
  return db.decision.findMany({
    where: {
      orgId,
      ...(caseId ? { caseId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Approve a decision.
 */
export async function approveDecision(
  id: string,
  decidedBy: string
): Promise<Decision> {
  const decision = await db.decision.findUnique({ where: { id } });
  if (!decision) throw notFound("Decision not found");
  return db.decision.update({
    where: { id },
    data: {
      status: "APPROVED",
      decidedBy,
      decidedAt: new Date(),
    },
  });
}

/**
 * Reject a decision.
 */
export async function rejectDecision(
  id: string,
  decidedBy: string,
  reasoning: string
): Promise<Decision> {
  const decision = await db.decision.findUnique({ where: { id } });
  if (!decision) throw notFound("Decision not found");
  return db.decision.update({
    where: { id },
    data: {
      status: "REJECTED",
      decidedBy,
      decidedAt: new Date(),
      reason: reasoning,
    },
  });
}

/**
 * Escalate a decision for human review.
 */
export async function escalateDecision(id: string): Promise<Decision> {
  const decision = await db.decision.findUnique({ where: { id } });
  if (!decision) throw notFound("Decision not found");
  return db.decision.update({
    where: { id },
    data: { status: "ESCALATED" },
  });
}

/** Appeal window: 30 days from the original decision. Pure. */
export const APPEAL_WINDOW_MS = 30 * 86400000;

export function appealDeadline(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + APPEAL_WINDOW_MS);
}

/**
 * File an appeal (§24.5): creates a NEW versioned row (status PENDING,
 * appealStatus OPEN) pointing at the original, which is never mutated.
 * Appellant must differ from the original maker AND checker (no self-appeal),
 * reason is mandatory, and filing must land inside the appeal window.
 */
export async function fileAppeal(input: {
  id: string;
  appellantId: string;
  reason: string;
  now?: Date;
}): Promise<Decision> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError("An appeal reason is mandatory", 400);
  const original = await db.decision.findUnique({ where: { id: input.id } });
  if (!original) throw notFound("Decision not found");
  if (
    !["APPROVED", "REJECTED"].includes(original.status) ||
    !original.decidedAt
  ) {
    throw new DomainError("Only a decided decision can be appealed", 409);
  }
  if (
    original.decidedBy === input.appellantId ||
    original.approverId === input.appellantId
  ) {
    throw new DomainError(
      "Maker and checker cannot appeal their own decision",
      403
    );
  }
  if (appealDeadline(original.decidedAt) < now) {
    throw new DomainError("The appeal window has expired", 409);
  }
  const open = await db.decision.findFirst({
    where: { appealOf: original.id, appealStatus: "OPEN" },
    select: { id: true },
  });
  if (open)
    throw new DomainError("An appeal is already open for this decision", 409);
  const latest = await db.decision.findFirst({
    where: { OR: [{ id: original.id }, { appealOf: original.id }] },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return db.decision.create({
    data: {
      orgId: original.orgId,
      caseId: original.caseId,
      type: original.type,
      status: "PENDING",
      appealOf: original.id,
      version: (latest?.version ?? 1) + 1,
      appellantId: input.appellantId,
      appealReason: reason,
      appealExpiresAt: appealDeadline(original.decidedAt),
      appealStatus: "OPEN",
    },
  });
}

/**
 * Decide an appeal (UPHELD | OVERTURNED). The decider must hold senior
 * authority (enforced on the route via decision.resolve) and must be none of
 * appellant, original maker, original checker — maker/checker stay intact.
 */
export async function decideAppeal(input: {
  id: string;
  deciderId: string;
  outcome: "UPHELD" | "OVERTURNED";
  reason: string;
  now?: Date;
}): Promise<Decision> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim();
  if (!reason)
    throw new DomainError("An appeal decision reason is mandatory", 400);
  if (input.outcome !== "UPHELD" && input.outcome !== "OVERTURNED") {
    throw new DomainError("Outcome must be UPHELD or OVERTURNED", 400);
  }
  const appeal = await db.decision.findUnique({ where: { id: input.id } });
  if (!appeal) throw notFound("Decision not found");
  if (!appeal.appealOf || appeal.appealStatus !== "OPEN") {
    throw new DomainError("No open appeal on this record", 409);
  }
  if (appeal.appealExpiresAt && appeal.appealExpiresAt < now) {
    throw new DomainError("The appeal window has expired", 409);
  }
  if (appeal.appellantId === input.deciderId) {
    throw new DomainError("The appellant cannot decide their own appeal", 403);
  }
  const original = await db.decision.findUnique({
    where: { id: appeal.appealOf },
  });
  if (
    original &&
    (original.decidedBy === input.deciderId ||
      original.approverId === input.deciderId)
  ) {
    throw new DomainError(
      "Original maker and checker cannot decide the appeal",
      403
    );
  }
  return db.decision.update({
    where: { id: appeal.id },
    data: {
      status: input.outcome === "OVERTURNED" ? "REJECTED" : "APPROVED",
      decision: input.outcome,
      reason,
      decidedBy: input.deciderId,
      decidedAt: now,
      appealStatus: input.outcome === "OVERTURNED" ? "OVERTURNED" : "UPHELD",
    },
  });
}
