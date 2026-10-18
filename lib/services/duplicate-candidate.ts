import { db } from "@/lib/db";

export interface CreateDuplicateCandidateInput {
  orgId: string;
  partyId: string;
  candidatePartyId: string;
  score: number;
}

export async function createDuplicateCandidate(input: CreateDuplicateCandidateInput) {
  return db.duplicateCandidate.create({
    data: {
      orgId: input.orgId,
      partyId: input.partyId,
      candidatePartyId: input.candidatePartyId,
      score: input.score,
    },
  });
}

export async function getDuplicateCandidate(id: string) {
  return db.duplicateCandidate.findUnique({
    where: { id },
  });
}

export async function getDuplicateCandidates(orgId: string, status?: string) {
  return db.duplicateCandidate.findMany({
    where: {
      orgId,
      ...(status ? { status } : {}),
    },
    orderBy: { score: "desc" },
  });
}

export async function confirmDuplicateCandidate(id: string, reviewedBy: string) {
  return db.duplicateCandidate.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      reviewedBy,
      reviewedAt: new Date(),
    },
  });
}

export async function dismissDuplicateCandidate(id: string, reviewedBy: string) {
  return db.duplicateCandidate.update({
    where: { id },
    data: {
      status: "DISMISSED",
      reviewedBy,
      reviewedAt: new Date(),
    },
  });
}
