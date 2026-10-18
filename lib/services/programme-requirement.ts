import { db } from "@/lib/db";

export interface CreateProgrammeRequirementInput {
  programmeId: string;
  versionId: string;
  key: string;
  title: string;
  description?: string;
  windowDays?: number;
  appliesTo?: "PRIMARY" | "SPOUSE" | "CHILD" | "ALL";
  apostille?: boolean;
  translation?: boolean;
}

export interface UpdateProgrammeRequirementInput {
  title?: string;
  description?: string;
  windowDays?: number;
  appliesTo?: "PRIMARY" | "SPOUSE" | "CHILD" | "ALL";
  apostille?: boolean;
  translation?: boolean;
}

export async function createProgrammeRequirement(input: CreateProgrammeRequirementInput) {
  return db.programmeRequirement.create({
    data: {
      programmeId: input.programmeId,
      versionId: input.versionId,
      key: input.key,
      title: input.title,
      description: input.description ?? "",
      windowDays: input.windowDays,
      appliesTo: input.appliesTo ?? "PRIMARY",
      apostille: input.apostille ?? false,
      translation: input.translation ?? false,
    },
  });
}

export async function getProgrammeRequirement(id: string) {
  return db.programmeRequirement.findUnique({
    where: { id },
  });
}

export async function getProgrammeRequirements(filters: {
  programmeId?: string;
  versionId?: string;
}) {
  return db.programmeRequirement.findMany({
    where: {
      ...(filters.programmeId ? { programmeId: filters.programmeId } : {}),
      ...(filters.versionId ? { versionId: filters.versionId } : {}),
    },
    orderBy: { key: "asc" },
  });
}

export async function updateProgrammeRequirement(
  id: string,
  input: UpdateProgrammeRequirementInput
) {
  return db.programmeRequirement.update({
    where: { id },
    data: input,
  });
}

export async function deleteProgrammeRequirement(id: string) {
  return db.programmeRequirement.delete({
    where: { id },
  });
}
