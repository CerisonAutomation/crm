import { db } from "@/lib/db";

export interface CreateExternalIdentityInput {
  partyId: string;
  provider: string;
  externalId: string;
  confidence?: number;
  source?: "MANUAL" | "IMPORT" | "MERGE";
}

export async function createExternalIdentity(input: CreateExternalIdentityInput) {
  return db.externalIdentity.create({
    data: {
      partyId: input.partyId,
      provider: input.provider,
      externalId: input.externalId,
      confidence: input.confidence ?? 0,
      source: input.source ?? "MANUAL",
    },
  });
}

export async function getExternalIdentity(id: string) {
  return db.externalIdentity.findUnique({
    where: { id },
    include: { party: true },
  });
}

export async function getExternalIdentities(partyId: string) {
  return db.externalIdentity.findMany({
    where: { partyId },
    orderBy: { createdAt: "desc" },
  });
}

export async function findExternalIdentity(provider: string, externalId: string) {
  return db.externalIdentity.findUnique({
    where: {
      provider_externalId: {
        provider,
        externalId,
      },
    },
    include: { party: true },
  });
}

export async function updateExternalIdentity(
  id: string,
  data: { confidence?: number; status?: "ACTIVE" | "MERGED" | "SPLIT" }
) {
  return db.externalIdentity.update({
    where: { id },
    data,
  });
}

export async function deleteExternalIdentity(id: string) {
  return db.externalIdentity.delete({
    where: { id },
  });
}
