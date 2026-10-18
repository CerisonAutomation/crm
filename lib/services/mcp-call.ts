import { db } from "@/lib/db";

export interface CreateMcpCallInput {
  orgId: string;
  toolId: string;
  actorId: string;
  input?: string;
}

export interface CompleteMcpCallInput {
  status: "SUCCEEDED" | "FAILED" | "DENIED";
  output?: string;
  error?: string;
  durationMs?: number;
}

export async function createMcpCall(input: CreateMcpCallInput) {
  return db.mcpCall.create({
    data: {
      orgId: input.orgId,
      toolId: input.toolId,
      actorId: input.actorId,
      input: input.input ?? "{}",
    },
  });
}

export async function getMcpCall(id: string) {
  return db.mcpCall.findUnique({
    where: { id },
    include: { tool: true },
  });
}

export async function getMcpCalls(orgId: string, filters?: {
  toolId?: string;
  actorId?: string;
  status?: string;
}) {
  return db.mcpCall.findMany({
    where: {
      orgId,
      ...(filters?.toolId ? { toolId: filters.toolId } : {}),
      ...(filters?.actorId ? { actorId: filters.actorId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function completeMcpCall(id: string, input: CompleteMcpCallInput) {
  return db.mcpCall.update({
    where: { id },
    data: {
      status: input.status,
      output: input.output ?? "{}",
      error: input.error,
      durationMs: input.durationMs,
    },
  });
}
