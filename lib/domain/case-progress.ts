/**
 * Case progress scoring — pure, Prisma-free computation.
 *
 * Derives a 0–100 completion score from the current state of a case.
 * Used for the RM vitals strip and the client journey bar.
 *
 * This module MUST NOT import `@/lib/db` or any server-only module — it is
 * imported by both server code (API routes) and client components.
 */
import { requiredDocumentRequests, reconcileRequirements } from "@/lib/domain/programmes";

export type CaseProgress = {
  /** Overall completion percentage (0–100). */
  percentage: number;
  /** Number of required documents uploaded & approved. */
  docsApproved: number;
  /** Number of required documents requested. */
  docsRequired: number;
  /** Number of required documents pending client upload/confirmation. */
  docsPending: number;
  /** Number of required documents with changes requested. */
  docsChangesRequested: number;
  /** Number of required documents rejected. */
  docsRejected: number;
  /** Current lifecycle stage label. */
  stage: string;
};

/** Minimal shape of a document needed for progress scoring. */
export type ProgressDocument = {
  type: string;
  status: string;
};

/** Minimal shape of a follow-up needed for progress scoring. */
export type ProgressFollowUp = {
  status: string;
};

/** Minimal shape of a case needed for progress scoring. */
export type ProgressCaseInput = {
  status: string;
  programmeKey: string | null;
  documents: ReadonlyArray<ProgressDocument>;
  dispatches: ReadonlyArray<unknown>;
  letters: ReadonlyArray<unknown>;
  followUps: ReadonlyArray<ProgressFollowUp>;
};

/**
 * Compute case progress from the given case data.
 *
 * The score is a weighted blend of:
 *   - Document completeness (50%): approved / required
 *   - Case lifecycle position (30%): how far through the state machine
 *   - Work completion (20%): follow-ups, dispatch, letter
 */
export function computeCaseProgress(c: ProgressCaseInput): CaseProgress {
  // 1) Document completeness
  const reqs = requiredDocumentRequests(c.programmeKey ?? "");
  const reconciliation = reconcileRequirements(c.programmeKey, c.documents.map((d) => d.type));
  const docsRequired = reqs.length;
  const docsApproved = c.documents.filter((d) => d.status === "RM_APPROVED").length;
  const docsPending = c.documents.filter((d) => ["UPLOADED", "OCR_PROCESSING", "OCR_PROCESSED", "CLIENT_CONFIRMED", "IN_REVIEW"].includes(d.status)).length;
  const docsChangesRequested = c.documents.filter((d) => d.status === "CHANGES_REQUESTED").length;
  const docsRejected = c.documents.filter((d) => d.status === "RM_REJECTED").length;

  const docCompleteness = docsRequired > 0 ? docsApproved / docsRequired : 1;

  // 2) Lifecycle position — map status to a 0–1 position
  const statusOrder = [
    "ONBOARDING",
    "DATA_SUBMITTED",
    "DATA_APPROVED",
    "SERVICE_SELECTED",
    "SERVICE_APPROVED",
    "DOCS_REQUESTED",
    "IN_PROGRESS",
    "DISPATCHED",
    "FOLLOW_UP",
    "APPROVED_IN_PRINCIPLE",
    "COMPLETED",
    "CANCELLED",
  ];
  const statusIndex = statusOrder.indexOf(c.status);
  const lifecycleProgress = statusIndex >= 0 ? statusIndex / (statusOrder.length - 2) : 0; // exclude terminal states

  // 3) Work completion — dispatch + letter + follow-up
  const hasDispatch = c.dispatches.length > 0;
  const hasLetter = c.letters.length > 0;
  const hasFollowUp = c.followUps.some((f) => f.status === "COMPLETED");
  const workProgress = (hasDispatch ? 1 : 0) + (hasLetter ? 1 : 0) + (hasFollowUp ? 1 : 0);
  const workScore = workProgress / 3;

  // Weighted blend
  const percentage = Math.round(Math.min(100, (docCompleteness * 50) + (lifecycleProgress * 30) + (workScore * 20)));

  return {
    percentage,
    docsApproved,
    docsRequired,
    docsPending,
    docsChangesRequested,
    docsRejected,
    stage: c.status,
  };
}
