/**
 * Duplicate-merge use-cases - pure orchestration over injected ports.
 *
 * Hexagonal position: this module owns the review-queue and merge-execution
 * rules (four-eyes, terminal review states, history preservation,
 * idempotency) and touches no infrastructure - every store is a port passed
 * in DuplicateMergeDeps. Prisma-free, so fake-port specs prove the unhappy
 * paths without a database (C4). The Prisma wiring lives in
 * src/lib/adapters/duplicate-merge.ts, composed in ./composition.ts.
 */
import {
  checkFourEyes,
  checkRestoreFourEyes,
  checkReviewTransition,
  planMerge,
  planRestore,
  reviewTargetStatus,
} from "@/lib/domain/duplicate-merge";
import type {
  DuplicateAuditPort,
  DuplicateCandidateLike,
  DuplicateMergeDeps,
  MergeExecutionReceipt,
  RestoreExecutionReceipt,
  RestorePort,
  ReviewDecision,
} from "@/lib/ports/duplicate-merge";

export type ReviewReceipt =
  | { ok: true; candidate: DuplicateCandidateLike }
  | { ok: false; error: string };

export type MergeReceipt =
  | {
      ok: true;
      ledgerId: string;
      receipt: MergeExecutionReceipt;
      deduped: boolean;
    }
  | { ok: false; error: string };

export interface ReviewCandidateInput {
  candidateId: string;
  orgId: string;
  reviewerId: string;
  reviewerLabel?: string;
  /** Actor that filed the candidate (user id, or 'system' for the detection job). */
  reportedBy: string | null;
  decision: ReviewDecision;
  reason?: string | null;
  correlationId?: string;
}

/**
 * Review one queued candidate. Unhappy-first: unknown id, cross-org access,
 * settled candidate, self-review and noteless dismissal all fail BEFORE any
 * write. Every decision is audit-logged (C11 receipt via the candidate row).
 */
export async function reviewDuplicateCandidate(
  deps: DuplicateMergeDeps,
  input: ReviewCandidateInput
): Promise<ReviewReceipt> {
  const candidate = await deps.queue.getCandidate(input.candidateId);
  if (!candidate) return { ok: false, error: "review: candidate not found" };
  if (candidate.orgId !== input.orgId) {
    return {
      ok: false,
      error: "review: candidate belongs to another organisation",
    };
  }
  const eyes = checkFourEyes(input.reportedBy, input.reviewerId);
  if (eyes) return { ok: false, error: eyes };
  const transition = checkReviewTransition(
    candidate.status,
    input.decision,
    input.reason
  );
  if (transition) return { ok: false, error: transition };

  const status = reviewTargetStatus(input.decision);
  const updated = await deps.review.markReviewed(candidate.id, {
    status,
    reviewedBy: input.reviewerId,
  });
  await deps.audit.write({
    orgId: input.orgId,
    actorId: input.reviewerId,
    actorLabel: input.reviewerLabel ?? input.reviewerId,
    action:
      input.decision === "CONFIRM"
        ? "party.duplicate.confirmed"
        : "party.duplicate.dismissed",
    target: candidate.id,
    before: { status: candidate.status },
    after: { status, reviewedBy: input.reviewerId },
    reason: input.reason ?? undefined,
    correlationId: input.correlationId,
  });
  return { ok: true, candidate: updated };
}

export interface ExecuteMergeInput {
  candidateId: string;
  orgId: string;
  survivorId: string;
  absorbedId: string;
  executorId: string;
  executorLabel?: string;
  /** Actor that filed the candidate - the executor must be someone else (four-eyes). */
  reportedBy: string | null;
  reason: string;
  correlationId?: string;
}

/**
 * Execute a CONFIRMED merge with full history preservation: the survivor keeps
 * every conflicting field, the absorbed row only fills gaps, its relations
 * (external identities, conversations) are re-pointed, the absorbed row is
 * tombstoned MERGED (never deleted), and its snapshot lands in the ledger.
 *
 * Unhappy-first: unconfirmed/dismissed candidates, self-review execution,
 * self-merge, cross-org pairs and missing reasons fail before any write.
 * Idempotent (C9): a prior ledger row for the same pair returns the earlier
 * receipt with deduped:true instead of moving history twice.
 */
export async function executePartyMerge(
  deps: DuplicateMergeDeps,
  input: ExecuteMergeInput
): Promise<MergeReceipt> {
  if (!input.reason || input.reason.trim().length === 0) {
    return { ok: false, error: "merge: a reason note is required" };
  }
  const eyes = checkFourEyes(input.reportedBy, input.executorId);
  if (eyes) return { ok: false, error: eyes };
  if (input.survivorId === input.absorbedId) {
    return { ok: false, error: "merge: cannot merge a party into itself" };
  }
  const candidate = await deps.queue.getCandidate(input.candidateId);
  if (!candidate) return { ok: false, error: "merge: candidate not found" };
  if (candidate.orgId !== input.orgId) {
    return {
      ok: false,
      error: "merge: candidate belongs to another organisation",
    };
  }
  if (candidate.status !== "CONFIRMED") {
    return {
      ok: false,
      error:
        "merge: candidate is " +
        candidate.status +
        " - confirm it before merging",
    };
  }
  const pairCoversCandidate =
    (candidate.partyId === input.survivorId &&
      candidate.candidatePartyId === input.absorbedId) ||
    (candidate.partyId === input.absorbedId &&
      candidate.candidatePartyId === input.survivorId);
  if (!pairCoversCandidate) {
    return {
      ok: false,
      error: "merge: pair does not match the confirmed candidate",
    };
  }

  const prior = await deps.merge.findPriorMerge(
    input.orgId,
    input.absorbedId,
    input.survivorId
  );
  if (prior) {
    return {
      ok: true,
      ledgerId: prior.id,
      receipt: {
        ledgerId: prior.id,
        movedExternalIdentities: 0,
        movedConversations: 0,
        fieldFills: {},
      },
      deduped: true,
    };
  }

  const pair = await deps.merge.loadPartyPair(
    input.orgId,
    input.survivorId,
    input.absorbedId
  );
  if (!pair)
    return {
      ok: false,
      error: "merge: party pair not found in this organisation",
    };
  const planned = planMerge(input.orgId, pair.survivor, pair.absorbed);
  if (!planned.ok) return { ok: false, error: planned.error };

  const receipt = await deps.merge.applyMerge(planned.plan, {
    performedBy: input.executorId,
    reason: input.reason.trim(),
    correlationId: input.correlationId,
  });
  await deps.audit.write({
    orgId: input.orgId,
    actorId: input.executorId,
    actorLabel: input.executorLabel ?? input.executorId,
    action: "party.merged",
    target: input.survivorId,
    before: {
      survivor: planned.plan.survivorSnapshot,
      absorbed: planned.plan.absorbedSnapshot,
    },
    after: {
      ledgerId: receipt.ledgerId,
      absorbedId: input.absorbedId,
      fieldFills: receipt.fieldFills,
      movedExternalIdentities: receipt.movedExternalIdentities,
      movedConversations: receipt.movedConversations,
    },
    reason: input.reason.trim(),
    correlationId: input.correlationId,
  });
  return { ok: true, ledgerId: receipt.ledgerId, receipt, deduped: false };
}

export type RestoreReceipt =
  | {
      ok: true;
      ledgerId: string;
      absorbedId: string;
      receipt: RestoreExecutionReceipt;
    }
  | { ok: false; error: string };

export interface ReverseMergeInput {
  ledgerId: string;
  orgId: string;
  reverserId: string;
  reverserLabel?: string;
  reason: string;
  correlationId?: string;
}

/**
 * Reverse a merge: the tombstoned absorbed party returns to ACTIVE, the
 * survivor rolls back exactly the filled fields, and the moved relations
 * go home. Unhappy-first: missing reason, unknown record, strict four-eyes
 * (reverser differs from performer AND confirmer), legacy untracked merges,
 * and post-merge survivor drift all fail before any write.
 */
export async function reversePartyMerge(
  deps: { restore: RestorePort; audit: DuplicateAuditPort },
  input: ReverseMergeInput
): Promise<RestoreReceipt> {
  if (!input.reason || input.reason.trim().length === 0) {
    return { ok: false, error: "restore: a reason note is required" };
  }
  const bundle = await deps.restore.loadMergeRecord(
    input.orgId,
    input.ledgerId
  );
  if (!bundle) return { ok: false, error: "restore: merge record not found" };
  if (
    bundle.record.orgId !== input.orgId ||
    bundle.ledger.orgId !== input.orgId
  ) {
    return {
      ok: false,
      error: "restore: merge belongs to another organisation",
    };
  }
  const eyes = checkRestoreFourEyes(bundle.record, input.reverserId);
  if (eyes) return { ok: false, error: eyes };
  const planned = planRestore(
    input.orgId,
    bundle.record,
    bundle.currentSurvivor,
    bundle.currentAbsorbed
  );
  if (!planned.ok) return { ok: false, error: planned.error };
  const receipt = await deps.restore.applyRestore(planned.plan, {
    performedBy: input.reverserId,
    reason: input.reason.trim(),
    correlationId: input.correlationId,
  });
  await deps.audit.write({
    orgId: input.orgId,
    actorId: input.reverserId,
    actorLabel: input.reverserLabel ?? input.reverserId,
    action: "party.merge.restored",
    target: planned.plan.absorbedId,
    before: { ledgerId: input.ledgerId },
    after: {
      restoreLedgerId: receipt.ledgerId,
      movedBack:
        receipt.movedBackExternalIdentities + receipt.movedBackConversations,
    },
    reason: input.reason.trim(),
    correlationId: input.correlationId,
  });
  return {
    ok: true,
    ledgerId: receipt.ledgerId,
    absorbedId: planned.plan.absorbedId,
    receipt,
  };
}

/** Queue read for the review UI: PENDING candidates, highest score first. */
export async function listDuplicateReviewQueue(
  deps: DuplicateMergeDeps,
  orgId: string
) {
  return deps.queue.listPending(orgId);
}
