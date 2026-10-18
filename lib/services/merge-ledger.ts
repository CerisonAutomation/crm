import { db } from "@/lib/db";

export interface CreateMergeLedgerInput {
  orgId: string;
  partyId: string;
  operation: "MERGE" | "SPLIT";
  sourcePartyId?: string;
  targetPartyId?: string;
  reason?: string;
  performedBy?: string;
}

export async function createMergeLedgerEntry(input: CreateMergeLedgerInput) {
  return db.mergeLedger.create({
    data: {
      orgId: input.orgId,
      partyId: input.partyId,
      operation: input.operation,
      sourcePartyId: input.sourcePartyId,
      targetPartyId: input.targetPartyId,
      reason: input.reason,
      performedBy: input.performedBy,
    },
  });
}

export async function getMergeLedgerEntry(id: string) {
  return db.mergeLedger.findUnique({
    where: { id },
  });
}

export async function getMergeLedger(orgId: string, partyId?: string) {
  return db.mergeLedger.findMany({
    where: {
      orgId,
      ...(partyId ? { partyId } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}
