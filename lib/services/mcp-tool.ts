import { db } from "@/lib/db";

export interface CreateMcpToolInput {
  orgId: string;
  name: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
  sensitivity?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
  rateLimit?: number;
  timeoutMs?: number;
  confirmationPolicy?: "NONE" | "ALWAYS" | "HIGH_IMPACT";
  auditAction?: string;
}

export interface UpdateMcpToolInput {
  name?: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
  sensitivity?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
  rateLimit?: number;
  timeoutMs?: number;
  confirmationPolicy?: "NONE" | "ALWAYS" | "HIGH_IMPACT";
  enabled?: boolean;
}

export async function createMcpTool(input: CreateMcpToolInput) {
  return db.mcpTool.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? "",
      inputSchema: input.inputSchema ?? "{}",
      outputSchema: input.outputSchema ?? "{}",
      sensitivity: input.sensitivity ?? "INTERNAL",
      rateLimit: input.rateLimit ?? 60,
      timeoutMs: input.timeoutMs ?? 30000,
      confirmationPolicy: input.confirmationPolicy ?? "NONE",
      auditAction: input.auditAction ?? "mcp.tool.called",
    },
  });
}

export async function getMcpTool(id: string) {
  return db.mcpTool.findUnique({
    where: { id },
  });
}

export async function getMcpTools(orgId: string, filters?: {
  enabled?: boolean;
  sensitivity?: string;
}) {
  return db.mcpTool.findMany({
    where: {
      orgId,
      ...(filters?.enabled !== undefined ? { enabled: filters.enabled } : {}),
      ...(filters?.sensitivity ? { sensitivity: filters.sensitivity } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function updateMcpTool(id: string, input: UpdateMcpToolInput) {
  return db.mcpTool.update({
    where: { id },
    data: input,
  });
}

export async function deleteMcpTool(id: string) {
  return db.mcpTool.delete({
    where: { id },
  });
}
