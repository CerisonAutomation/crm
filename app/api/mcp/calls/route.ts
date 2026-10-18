import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createMcpCall, getMcpCalls } from "@/lib/services/mcp-call";
import { getMcpTool } from "@/lib/services/mcp-tool";
import { notFound, validationFailed } from "@/lib/api-errors";

// GET /api/mcp/calls — ADMIN-only tool-call ledger.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const params = new URL(r.url).searchParams;
    const calls = await getMcpCalls(ctx.orgId, {
      toolId: params.get("toolId") || undefined,
      actorId: params.get("actorId") || undefined,
      status: params.get("status") || undefined,
    });
    return jsonOk({ calls });
  })(req);
}

// POST /api/mcp/calls — record a tool invocation (intent).
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{ toolId?: string; input?: string }>(r);
    if (!body?.toolId) throw validationFailed("toolId is required");
    const tool = await getMcpTool(body.toolId);
    if (!tool || tool.orgId !== ctx.orgId) throw notFound("Tool not found");
    const call = await createMcpCall({
      orgId: ctx.orgId,
      toolId: tool.id,
      actorId: ctx.userId,
      input: body.input,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: tool.auditAction,
      target: call.id,
      after: { toolId: tool.id },
      correlationId,
    });
    return jsonOk({ call }, 201);
  })(req);
}
