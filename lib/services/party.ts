import { db } from "@/lib/db";

export interface CreatePartyInput {
  orgId: string;
  type?: "INDIVIDUAL" | "COMPANY";
  name: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface UpdatePartyInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  status?: "ACTIVE" | "MERGED" | "ARCHIVED";
}

export async function createParty(input: CreatePartyInput) {
  return db.party.create({
    data: {
      orgId: input.orgId,
      type: input.type ?? "INDIVIDUAL",
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
    },
  });
}

export async function getParty(id: string) {
  return db.party.findUnique({
    where: { id },
    include: {
      externalIdentities: true,
      mergeHistory: true,
    },
  });
}

export async function getParties(orgId: string, type?: string) {
  return db.party.findMany({
    where: {
      orgId,
      ...(type ? { type } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateParty(id: string, input: UpdatePartyInput) {
  return db.party.update({
    where: { id },
    data: input,
  });
}

export async function deleteParty(id: string) {
  return db.party.delete({
    where: { id },
  });
}

export async function findDuplicateCandidates(partyId: string) {
  return db.duplicateCandidate.findMany({
    where: {
      OR: [
        { partyId },
        { candidatePartyId: partyId },
      ],
    },
    orderBy: { score: "desc" },
  });
}

export async function confirmDuplicate(id: string, reviewedBy: string) {
  return db.duplicateCandidate.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      reviewedBy,
      reviewedAt: new Date(),
    },
  });
}

export async function dismissDuplicate(id: string, reviewedBy: string) {
  return db.duplicateCandidate.update({
    where: { id },
    data: {
      status: "DISMISSED",
      reviewedBy,
      reviewedAt: new Date(),
    },
  });
}

export async function mergeParties(
  sourcePartyId: string,
  targetPartyId: string,
  performedBy: string,
  reason?: string
) {
  return db.$transaction(async (tx) => {
    const source = await tx.party.findUnique({ where: { id: sourcePartyId } });
    if (!source) throw new Error("Source party not found");

    const ledgerEntry = await tx.mergeLedger.create({
      data: {
        orgId: source.orgId,
        partyId: targetPartyId,
        operation: "MERGE",
        sourcePartyId,
        targetPartyId,
        reason,
        performedBy,
      },
    });

    await tx.party.update({
      where: { id: sourcePartyId },
      data: { status: "MERGED" },
    });

    return ledgerEntry;
  });
}

export async function getMergeHistory(partyId: string) {
  return db.mergeLedger.findMany({
    where: { partyId },
    orderBy: { createdAt: "desc" },
  });
}
