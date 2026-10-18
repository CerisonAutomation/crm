/**
 * H2 adapters - Prisma-backed duplicate-merge ports. Server-only: never
 * imported from client components (the H4 gate forbids generated-Prisma
 * types there). The merge runs in ONE transaction - history moves, the
 * tombstone, the ledger row and the audit event commit together or not at
 * all (same mutation-boundary rule as case-service.ts).
 */
import { db } from "@/lib/db";
import type { MergeFieldFills, PartyFacts } from "@/lib/domain/duplicate-merge";
import type {
  DuplicateAuditPort,
  DuplicateCandidateLike,
  DuplicateQueuePort,
  DuplicateReviewPort,
  MergeLedgerLike,
  MergeRecordBundle,
  PartyMergePort,
  PartyPairLike,
  RestoreExecutionReceipt,
  RestorePort,
} from "@/lib/ports/duplicate-merge";

function toCandidateLike(row: {
  id: string;
  orgId: string;
  partyId: string;
  candidatePartyId: string;
  score: number;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}): DuplicateCandidateLike {
  return {
    id: row.id,
    orgId: row.orgId,
    partyId: row.partyId,
    candidatePartyId: row.candidatePartyId,
    score: row.score,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

function toFacts(row: {
  id: string;
  orgId: string;
  type: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
}): PartyFacts {
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    status: row.status,
  };
}

function toLedgerLike(row: {
  id: string;
  orgId: string;
  partyId: string;
  operation: string;
  sourcePartyId: string | null;
  targetPartyId: string | null;
  reason: string | null;
  performedBy: string | null;
}): MergeLedgerLike {
  return {
    id: row.id,
    orgId: row.orgId,
    partyId: row.partyId,
    operation: row.operation,
    sourcePartyId: row.sourcePartyId,
    targetPartyId: row.targetPartyId,
    reason: row.reason,
    performedBy: row.performedBy,
  };
}

function parseAfter(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v))
      return v as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function pickAuditRow(
  audits: Array<{ after: unknown; before: unknown }>,
  ledgerId: string
): { after: unknown; before: unknown } | null {
  for (const row of audits) {
    const after = parseAfter(row.after);
    if (after && after.ledgerId === ledgerId) return row;
  }
  return null;
}

function readFills(after: Record<string, unknown> | null): MergeFieldFills {
  if (!after) return {};
  const v: unknown = after.fieldFills;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Partial<MergeFieldFills> = {};
  const o = v as Record<string, unknown>;
  if (typeof o.name === "string") out.name = o.name;
  if (typeof o.email === "string") out.email = o.email;
  else if (o.email === null) out.email = null;
  if (typeof o.phone === "string") out.phone = o.phone;
  else if (o.phone === null) out.phone = null;
  if (typeof o.company === "string") out.company = o.company;
  else if (o.company === null) out.company = null;
  return out as MergeFieldFills;
}

function isPartyFacts(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.orgId === "string" &&
    typeof o.name === "string" &&
    typeof o.status === "string"
  );
}

function readSnapshot(
  before: Record<string, unknown> | null,
  key: string
): PartyFacts | null {
  if (!before) return null;
  const v: unknown = before[key];
  if (!isPartyFacts(v)) return null;
  return v as PartyFacts;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

export const prismaDuplicateQueue: DuplicateQueuePort = {
  async listPending(orgId: string) {
    const rows = await db.duplicateCandidate.findMany({
      where: { orgId, status: "PENDING" },
      orderBy: { score: "desc" },
      take: 200,
    });
    return rows.map(toCandidateLike);
  },
  async getCandidate(id: string) {
    const row = await db.duplicateCandidate.findUnique({ where: { id } });
    return row ? toCandidateLike(row) : null;
  },
};

export const prismaDuplicateReview: DuplicateReviewPort = {
  async markReviewed(
    id: string,
    input: { status: "PENDING" | "CONFIRMED" | "DISMISSED"; reviewedBy: string }
  ) {
    const row = await db.duplicateCandidate.update({
      where: { id },
      data: {
        status: input.status,
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date(),
      },
    });
    return toCandidateLike(row);
  },
};

export const prismaPartyMerge: PartyMergePort = {
  async loadPartyPair(
    orgId: string,
    survivorId: string,
    absorbedId: string
  ): Promise<PartyPairLike | null> {
    const [survivor, absorbed, identities, conversations] = await Promise.all([
      db.party.findUnique({ where: { id: survivorId } }),
      db.party.findUnique({ where: { id: absorbedId } }),
      db.externalIdentity.count({ where: { partyId: absorbedId } }),
      db.conversation.count({ where: { partyId: absorbedId } }),
    ]);
    if (!survivor || !absorbed) return null;
    if (survivor.orgId !== orgId || absorbed.orgId !== orgId) return null;
    return {
      survivor: toFacts(survivor),
      absorbed: toFacts(absorbed),
      absorbedExternalIdentities: identities,
      absorbedConversations: conversations,
    };
  },
  async findPriorMerge(
    orgId: string,
    sourcePartyId: string,
    targetPartyId: string
  ) {
    const row = await db.mergeLedger.findFirst({
      where: { orgId, operation: "MERGE", sourcePartyId, targetPartyId },
      orderBy: { createdAt: "desc" },
    });
    return row ? toLedgerLike(row) : null;
  },
  async applyMerge(plan, audit) {
    return db.$transaction(async (tx) => {
      // MERGE-PLUS traceability: record exactly which rows move, so a later
      // reversal can send them home. updateMany returns counts only.
      const [movingIdentityIds, movingConversationIds] = await Promise.all([
        tx.externalIdentity.findMany({
          where: { partyId: plan.absorbedId },
          select: { id: true },
        }),
        tx.conversation.findMany({
          where: { partyId: plan.absorbedId },
          select: { id: true },
        }),
      ]);
      const movedIdentityIds = movingIdentityIds.map((r) => r.id);
      const movedConversationIds = movingConversationIds.map((r) => r.id);
      const [movedIdentities, movedConversations] = await Promise.all([
        tx.externalIdentity.updateMany({
          where: { partyId: plan.absorbedId },
          data: { partyId: plan.survivorId },
        }),
        tx.conversation.updateMany({
          where: { partyId: plan.absorbedId },
          data: { partyId: plan.survivorId },
        }),
      ]);
      if (Object.keys(plan.fieldFills).length > 0) {
        await tx.party.update({
          where: { id: plan.survivorId },
          data: { ...plan.fieldFills },
        });
      }
      await tx.party.update({
        where: { id: plan.absorbedId },
        data: { status: "MERGED" },
      });
      const ledger = await tx.mergeLedger.create({
        data: {
          orgId: plan.orgId,
          partyId: plan.survivorId,
          operation: "MERGE",
          sourcePartyId: plan.absorbedId,
          targetPartyId: plan.survivorId,
          reason: audit.reason,
          performedBy: audit.performedBy,
        },
      });
      await tx.auditEvent.create({
        data: {
          orgId: plan.orgId,
          actorId: audit.performedBy,
          actorLabel: audit.performedBy,
          action: "party.merged",
          target: plan.survivorId,
          before: JSON.stringify({
            survivor: plan.survivorSnapshot,
            absorbed: plan.absorbedSnapshot,
          }),
          after: JSON.stringify({
            ledgerId: ledger.id,
            absorbedId: plan.absorbedId,
            fieldFills: plan.fieldFills,
            movedExternalIdentityIds: movedIdentityIds,
            movedConversationIds: movedConversationIds,
          }),
          reason: audit.reason,
          correlationId: audit.correlationId,
        },
      });
      return {
        ledgerId: ledger.id,
        movedExternalIdentities: movedIdentities.count,
        movedConversations: movedConversations.count,
        fieldFills: plan.fieldFills,
        movedExternalIdentityIds: movedIdentityIds,
        movedConversationIds: movedConversationIds,
      };
    });
  },
};

export const prismaRestore: RestorePort = {
  async loadMergeRecord(orgId, ledgerId): Promise<MergeRecordBundle | null> {
    const ledger = await db.mergeLedger.findUnique({ where: { id: ledgerId } });
    if (!ledger || ledger.orgId !== orgId || ledger.operation !== "MERGE")
      return null;
    if (!ledger.sourcePartyId || !ledger.targetPartyId) return null;
    const audits = await db.auditEvent.findMany({
      where: { orgId: orgId, action: "party.merged" },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    // (candidate + parties load follows below)
    const picked = pickAuditRow(audits, ledger.id);
    void picked;
    const after = picked ? parseAfter(picked.after) : null;
    const before = picked ? parseAfter(picked.before) : null;
    const fills = readFills(after);
    const snapS = readSnapshot(before, "survivor");
    const snapA = readSnapshot(before, "absorbed");
    const tracked =
      snapS !== null &&
      snapA !== null &&
      after !== null &&
      asStringArray(after.movedExternalIdentityIds) !== null &&
      asStringArray(after.movedConversationIds) !== null;
    const [candidate, survivor, absorbed] = await Promise.all([
      db.duplicateCandidate.findFirst({
        where: {
          orgId: orgId,
          status: "CONFIRMED",
          OR: [
            {
              partyId: ledger.targetPartyId,
              candidatePartyId: ledger.sourcePartyId,
            },
            {
              partyId: ledger.sourcePartyId,
              candidatePartyId: ledger.targetPartyId,
            },
          ],
        },
        orderBy: { reviewedAt: "desc" },
      }),
      db.party.findUnique({ where: { id: ledger.targetPartyId } }),
      db.party.findUnique({ where: { id: ledger.sourcePartyId } }),
    ]);
    return {
      ledger: toLedgerLike(ledger),
      record: {
        ledgerId: ledger.id,
        orgId: ledger.orgId,
        survivorId: ledger.targetPartyId,
        absorbedId: ledger.sourcePartyId,
        performedBy: ledger.performedBy,
        confirmerId: candidate ? candidate.reviewedBy : null,
        survivorSnapshot: snapS,
        absorbedSnapshot: snapA,
        fieldFills: fills,
        movedExternalIdentityIds: tracked
          ? asStringArray(
              (after as Record<string, unknown>).movedExternalIdentityIds
            )
          : null,
        movedConversationIds: tracked
          ? asStringArray(
              (after as Record<string, unknown>).movedConversationIds
            )
          : null,
      },
      currentSurvivor: survivor ? toFacts(survivor) : null,
      currentAbsorbed: absorbed ? toFacts(absorbed) : null,
    };
  },

  async applyRestore(plan, audit): Promise<RestoreExecutionReceipt> {
    return db.$transaction(async (tx) => {
      const movedBack = { identities: 0, conversations: 0 };
      if (plan.moveBackExternalIdentityIds.length > 0) {
        const r = await tx.externalIdentity.updateMany({
          where: {
            id: { in: plan.moveBackExternalIdentityIds },
            partyId: plan.survivorId,
          },
          data: { partyId: plan.absorbedId },
        });
        movedBack.identities = r.count;
      }
      if (plan.moveBackConversationIds.length > 0) {
        const r = await tx.conversation.updateMany({
          where: {
            id: { in: plan.moveBackConversationIds },
            partyId: plan.survivorId,
          },
          data: { partyId: plan.absorbedId },
        });
        movedBack.conversations = r.count;
      }
      if (Object.keys(plan.survivorRollback).length > 0) {
        await tx.party.update({
          where: { id: plan.survivorId },
          data: { ...plan.survivorRollback },
        });
      }
      await tx.party.update({
        where: { id: plan.absorbedId },
        data: { status: "ACTIVE" },
      });
      const ledger = await tx.mergeLedger.create({
        data: {
          orgId: plan.orgId,
          partyId: plan.absorbedId,
          operation: "RESTORE",
          sourcePartyId: plan.survivorId,
          targetPartyId: plan.absorbedId,
          reason: audit.reason,
          performedBy: audit.performedBy,
        },
      });
      await tx.auditEvent.create({
        data: {
          orgId: plan.orgId,
          actorId: audit.performedBy,
          actorLabel: audit.performedBy,
          action: "party.merge.restored",
          target: plan.absorbedId,
          reason: audit.reason,
          correlationId: audit.correlationId,
        },
      });
      return {
        ledgerId: ledger.id,
        restoredPartyId: plan.absorbedId,
        movedBackExternalIdentities: movedBack.identities,
        movedBackConversations: movedBack.conversations,
      };
    });
  },
};

export const prismaDuplicateAudit: DuplicateAuditPort = {
  async write(entry) {
    try {
      await db.auditEvent.create({
        data: {
          orgId: entry.orgId,
          actorId: entry.actorId,
          actorLabel: entry.actorLabel,
          action: entry.action,
          target: entry.target,
          before:
            entry.before !== undefined
              ? JSON.stringify(entry.before)
              : undefined,
          after:
            entry.after !== undefined ? JSON.stringify(entry.after) : undefined,
          reason: entry.reason,
          correlationId: entry.correlationId,
        },
      });
    } catch {
      /* audit is advisory outside the merge transaction - never break the caller */
    }
  },
};
