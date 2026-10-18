/**
 * H2 ports - duplicate-merge slice (review queue + merge execution + audit).
 *
 * Strangler note: the legacy thin services (duplicate-candidate.ts,
 * merge-ledger.ts) keep serving their callers untouched. This slice adds the
 * guarded path - scoring, four-eyes review, history-preserving execution -
 * behind contracts so the use-cases never import the database (H2) and the
 * fake-port specs prove the rules without Prisma.
 *
 * Structural types only + offline defaults: Prisma-free, safe anywhere (H3).
 */
import type {
  CandidateStatus,
  MergePlan,
  MergeRecordLike,
  PartyFacts,
  RestorePlan,
  ReviewDecision,
} from "@/lib/domain/duplicate-merge";

export type {
  CandidateStatus,
  MergePlan,
  MergeRecordLike,
  PartyFacts,
  RestorePlan,
  ReviewDecision,
};

export interface DuplicateCandidateLike {
  id: string;
  orgId: string;
  partyId: string;
  candidatePartyId: string;
  score: number;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface MergeLedgerLike {
  id: string;
  orgId: string;
  partyId: string;
  operation: string;
  sourcePartyId: string | null;
  targetPartyId: string | null;
  reason: string | null;
  performedBy: string | null;
}

export interface PartyPairLike {
  survivor: PartyFacts;
  absorbed: PartyFacts;
  absorbedExternalIdentities: number;
  absorbedConversations: number;
}

export interface MergeExecutionReceipt {
  ledgerId: string;
  movedExternalIdentities: number;
  movedConversations: number;
  fieldFills: MergePlan["fieldFills"];
  /** Exact moved rows (MERGE-PLUS traceability). Optional so older fakes keep compiling. */
  movedExternalIdentityIds?: string[];
  movedConversationIds?: string[];
}

/** Review queue reads: the DuplicateCandidate PENDING list + single fetch. */
export interface DuplicateQueuePort {
  listPending(orgId: string): Promise<DuplicateCandidateLike[]>;
  getCandidate(id: string): Promise<DuplicateCandidateLike | null>;
}

export interface MarkReviewedInput {
  status: CandidateStatus;
  reviewedBy: string;
}

/** Review writes: the PENDING -> CONFIRMED | DISMISSED transition. */
export interface DuplicateReviewPort {
  markReviewed(
    id: string,
    input: MarkReviewedInput
  ): Promise<DuplicateCandidateLike>;
}

/** Merge execution: guarded history-preserving party merge + ledger row. */
export interface PartyMergePort {
  loadPartyPair(
    orgId: string,
    survivorId: string,
    absorbedId: string
  ): Promise<PartyPairLike | null>;
  findPriorMerge(
    orgId: string,
    sourcePartyId: string,
    targetPartyId: string
  ): Promise<MergeLedgerLike | null>;
  applyMerge(
    plan: MergePlan,
    audit: { performedBy: string; reason: string; correlationId?: string }
  ): Promise<MergeExecutionReceipt>;
}

export interface MergeAuditEntry {
  orgId: string;
  actorId: string | null;
  actorLabel: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  correlationId?: string;
}

/** Audit sink: every review decision and every merge lands in AuditEvent. */
export interface DuplicateAuditPort {
  write(entry: MergeAuditEntry): Promise<void>;
}

export interface DuplicateMergeDeps {
  queue: DuplicateQueuePort;
  review: DuplicateReviewPort;
  merge: PartyMergePort;
  audit: DuplicateAuditPort;
}

/** H3 offline defaults - queue reads empty, writes resolve without touching a store. */
export const offlineDuplicateQueue: DuplicateQueuePort = {
  listPending: async () => [],
  getCandidate: async () => null,
};

export const offlineDuplicateReview: DuplicateReviewPort = {
  markReviewed: async () => {
    throw new Error("offline: duplicate review not persisted");
  },
};

export const offlinePartyMerge: PartyMergePort = {
  loadPartyPair: async () => null,
  findPriorMerge: async () => null,
  applyMerge: async () => {
    throw new Error("offline: party merge not executed");
  },
};

// Merge reversal (MERGE-PLUS) contracts.

export interface MergeRecordBundle {
  ledger: MergeLedgerLike;
  record: MergeRecordLike;
  currentSurvivor: PartyFacts | null;
  currentAbsorbed: PartyFacts | null;
}

export interface RestoreExecutionReceipt {
  ledgerId: string;
  restoredPartyId: string;
  movedBackExternalIdentities: number;
  movedBackConversations: number;
}

export interface RestorePort {
  loadMergeRecord(
    orgId: string,
    ledgerId: string
  ): Promise<MergeRecordBundle | null>;
  applyRestore(
    plan: RestorePlan,
    audit: { performedBy: string; reason: string; correlationId?: string }
  ): Promise<RestoreExecutionReceipt>;
}

export const offlineRestore: RestorePort = {
  loadMergeRecord: async () => null,
  applyRestore: async () => {
    throw new Error("offline: party merge reversal not executed");
  },
};

export const offlineDuplicateAudit: DuplicateAuditPort = {
  write: async () => {},
};

export const offlineDuplicateMergeDeps: DuplicateMergeDeps = {
  queue: offlineDuplicateQueue,
  review: offlineDuplicateReview,
  merge: offlinePartyMerge,
  audit: offlineDuplicateAudit,
};
