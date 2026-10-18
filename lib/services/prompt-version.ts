import { db } from "@/lib/db";

export interface CreatePromptVersionInput {
  orgId: string;
  key: string;
  version?: number;
  prompt: string;
  model?: string;
}

export interface UpdatePromptVersionInput {
  prompt?: string;
  model?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

export async function createPromptVersion(input: CreatePromptVersionInput) {
  return db.promptVersion.create({
    data: {
      orgId: input.orgId,
      key: input.key,
      version: input.version ?? 1,
      prompt: input.prompt,
      model: input.model ?? "gpt-4",
    },
  });
}

export async function getPromptVersion(id: string) {
  return db.promptVersion.findUnique({
    where: { id },
  });
}

export async function getPromptVersions(orgId: string, filters?: {
  key?: string;
  status?: string;
}) {
  return db.promptVersion.findMany({
    where: {
      orgId,
      ...(filters?.key ? { key: filters.key } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
}

export async function getActivePromptVersion(orgId: string, key: string) {
  return db.promptVersion.findFirst({
    where: { orgId, key, status: "ACTIVE" },
    orderBy: { version: "desc" },
  });
}

export async function updatePromptVersion(id: string, input: UpdatePromptVersionInput) {
  return db.promptVersion.update({
    where: { id },
    data: input,
  });
}

export async function deletePromptVersion(id: string) {
  return db.promptVersion.delete({
    where: { id },
  });
}
