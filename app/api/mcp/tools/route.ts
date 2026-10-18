import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createMcpTool, getMcpTools } from "@/lib/services/mcp-tool";
import { validationFailed } from "@/lib/api-errors";

// GET /api/mcp/tools — ADMIN-only MCP tool registry.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const params = new URL(r.url).searchParams;
    const enabledParam = params.get("enabled");
    const tools = await getMcpTools(ctx.orgId, {
      enabled: enabledParam === null ? undefined : enabledParam === "true",
      sensitivity: params.get("sensitivity") || undefined,
    });
    return jsonOk({ tools });
  })(req);
}

// POST /api/mcp/tools — register a capability-scoped tool.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      name?: string;
      description?: string;
      inputSchema?: string;
      outputSchema?: string;
      sensitivity?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
      rateLimit?: number;
      timeoutMs?: number;
      confirmationPolicy?: "NONE" | "ALWAYS" | "HIGH_IMPACT";
    }>(r);
    if (!body?.name) throw validationFailed("name is required");
    const tool = await createMcpTool({
      orgId: ctx.orgId,
      name: body.name,
      description: body.description,
      inputSchema: body.inputSchema,
      outputSchema: body.outputSchema,
      sensitivity: body.sensitivity,
      rateLimit: body.rateLimit,
      timeoutMs: body.timeoutMs,
      confirmationPolicy: body.confirmationPolicy,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "mcp.tool.created",
      target: tool.id,
      after: { name: tool.name, sensitivity: tool.sensitivity },
      correlationId,
    });
    return jsonOk({ tool }, 201);
  })(req);
}
