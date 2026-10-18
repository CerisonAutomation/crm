import { db } from "@/lib/db";

export interface CreateEligibilitySignalInput {
  programmeId: string;
  versionId: string;
  key: string;
  title: string;
  description?: string;
  category?: "GENERAL" | "FINANCIAL" | "LEGAL" | "HEALTH";
}

export interface UpdateEligibilitySignalInput {
  title?: string;
  description?: string;
  category?: "GENERAL" | "FINANCIAL" | "LEGAL" | "HEALTH";
}

export async function createEligibilitySignal(input: CreateEligibilitySignalInput) {
  return db.eligibilitySignal.create({
    data: {
      programmeId: input.programmeId,
      versionId: input.versionId,
      key: input.key,
      title: input.title,
      description: input.description ?? "",
      category: input.category ?? "GENERAL",
    },
  });
}

export async function getEligibilitySignal(id: string) {
  return db.eligibilitySignal.findUnique({
    where: { id },
  });
}

export async function getEligibilitySignals(filters: {
  programmeId?: string;
  versionId?: string;
}) {
  return db.eligibilitySignal.findMany({
    where: {
      ...(filters.programmeId ? { programmeId: filters.programmeId } : {}),
      ...(filters.versionId ? { versionId: filters.versionId } : {}),
    },
    orderBy: { key: "asc" },
  });
}

export async function updateEligibilitySignal(id: string, input: UpdateEligibilitySignalInput) {
  return db.eligibilitySignal.update({
    where: { id },
    data: input,
  });
}

export async function deleteEligibilitySignal(id: string) {
  return db.eligibilitySignal.delete({
    where: { id },
  });
}
