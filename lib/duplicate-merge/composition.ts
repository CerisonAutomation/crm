/**
 * Composition root - duplicate-merge slice (ADR-004: one root per slice).
 *
 * Server-only: binds the Prisma adapters to the ports and exposes the two
 * guarded entry points routes call. Tests never import this module - they
 * inject fakes into the use-cases directly, which keeps unit specs
 * Prisma-free.
 */
import {
  prismaDuplicateAudit,
  prismaDuplicateQueue,
  prismaDuplicateReview,
  prismaPartyMerge,
  prismaRestore,
} from "@/lib/adapters/duplicate-merge";
import { planMerge } from "@/lib/domain/duplicate-merge";
import type { DuplicateMergeDeps } from "@/lib/ports/duplicate-merge";
import {
  executePartyMerge,
  listDuplicateReviewQueue,
  reviewDuplicateCandidate,
  reversePartyMerge,
} from "@/lib/duplicate-merge/usecases";
import type {
  ExecuteMergeInput,
  ReviewCandidateInput,
  ReverseMergeInput,
} from "@/lib/duplicate-merge/usecases";

export function duplicateMergeDeps(): DuplicateMergeDeps {
  return {
    queue: prismaDuplicateQueue,
    review: prismaDuplicateReview,
    merge: prismaPartyMerge,
    audit: prismaDuplicateAudit,
  };
}

export function reviewDuplicateCandidateRoot(input: ReviewCandidateInput) {
  return reviewDuplicateCandidate(duplicateMergeDeps(), input);
}

export function executePartyMergeRoot(input: ExecuteMergeInput) {
  return executePartyMerge(duplicateMergeDeps(), input);
}

export function listDuplicateReviewQueueRoot(orgId: string) {
  return listDuplicateReviewQueue(duplicateMergeDeps(), orgId);
}

/** Ledger reads for routes that must resolve server-side truth
    (e.g. the stored confirmer) without trusting request bodies. */

export function reversePartyMergeRoot(input: ReverseMergeInput) {
  return reversePartyMerge(
    { restore: prismaRestore, audit: prismaDuplicateAudit },
    input
  );
}

/** Read-only merge projection for the pre-confirm preview (no writes). */
export async function previewPartyMergeRoot(
  orgId: string,
  survivorId: string,
  absorbedId: string
) {
  const deps = duplicateMergeDeps();
  const pair = await deps.merge.loadPartyPair(orgId, survivorId, absorbedId);
  if (!pair)
    return {
      ok: false as const,
      error: "merge: party pair not found in this organisation",
    };
  const planned = planMerge(orgId, pair.survivor, pair.absorbed);
  if (!planned.ok) return planned;
  return {
    ok: true as const,
    plan: planned.plan,
    absorbedExternalIdentities: pair.absorbedExternalIdentities,
    absorbedConversations: pair.absorbedConversations,
  };
}

export function findPriorMergeRoot(
  orgId: string,
  sourcePartyId: string,
  targetPartyId: string
) {
  return duplicateMergeDeps().merge.findPriorMerge(
    orgId,
    sourcePartyId,
    targetPartyId
  );
}

export function loadMergeRecordRoot(orgId: string, ledgerId: string) {
  return prismaRestore.loadMergeRecord(orgId, ledgerId);
}
export function getDuplicateCandidateRoot(candidateId: string) {
  return duplicateMergeDeps().queue.getCandidate(candidateId);
}
