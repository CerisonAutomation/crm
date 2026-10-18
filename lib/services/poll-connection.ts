import { db } from "@/lib/db";

export interface CreatePollConnectionInput {
  orgId: string;
  sourceType: "EMAIL" | "API" | "FTP" | "WEBHOOK";
  owner: string;
  schedule: string;
  jitter?: number;
  timeoutMs?: number;
  cursorMode?: "TIMESTAMP" | "ID" | "OFFSET";
  pageSize?: number;
  rateBudget?: number;
  secretRef?: string;
  dataClass?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
  pausePolicy?: "NEVER" | "ON_ERROR" | "ON_RATE_LIMIT";
}

export interface UpdatePollConnectionInput {
  schedule?: string;
  jitter?: number;
  timeoutMs?: number;
  cursorMode?: "TIMESTAMP" | "ID" | "OFFSET";
  pageSize?: number;
  rateBudget?: number;
  secretRef?: string;
  dataClass?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
  pausePolicy?: "NEVER" | "ON_ERROR" | "ON_RATE_LIMIT";
  status?: "ACTIVE" | "PAUSED" | "DISABLED";
}

export async function createPollConnection(input: CreatePollConnectionInput) {
  return db.pollConnection.create({
    data: {
      orgId: input.orgId,
      sourceType: input.sourceType,
      owner: input.owner,
      schedule: input.schedule,
      jitter: input.jitter ?? 0,
      timeoutMs: input.timeoutMs ?? 30000,
      cursorMode: input.cursorMode ?? "TIMESTAMP",
      pageSize: input.pageSize ?? 100,
      rateBudget: input.rateBudget ?? 60,
      secretRef: input.secretRef,
      dataClass: input.dataClass ?? "INTERNAL",
      pausePolicy: input.pausePolicy ?? "ON_ERROR",
    },
  });
}

export async function getPollConnection(id: string) {
  return db.pollConnection.findUnique({
    where: { id },
    include: { checkpoints: true },
  });
}

export async function getPollConnections(orgId: string, filters?: {
  status?: string;
  sourceType?: string;
}) {
  return db.pollConnection.findMany({
    where: {
      orgId,
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.sourceType ? { sourceType: filters.sourceType } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updatePollConnection(id: string, input: UpdatePollConnectionInput) {
  return db.pollConnection.update({
    where: { id },
    data: input,
  });
}

export async function deletePollConnection(id: string) {
  return db.pollConnection.delete({
    where: { id },
  });
}
