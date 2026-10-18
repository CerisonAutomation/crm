import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getMcpTool, updateMcpTool, deleteMcpTool } from "@/lib/services/mcp-tool";
import { notFound } from "@/lib/api-errors";

// GET /api/mcp/tools/[id] — ADMIN-only tool detail.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const tool = await getMcpTool(id);
    if (!tool || tool.orgId !== ctx.orgId) throw notFound("Tool not found");
    return jsonOk({ tool });
  })(req);
}

// PATCH /api/mcp/tools/[id] — update a tool definition.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const existing = await getMcpTool(id);
    if (!existing || existing.orgId !== ctx.orgId) throw notFound("Tool not found");
    const body = await readJson<{
      name?: string;
      description?: string;
      inputSchema?: string;
      outputSchema?: string;
      sensitivity?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
      rateLimit?: number;
      timeoutMs?: number;
      confirmationPolicy?: "NONE" | "ALWAYS" | "HIGH_IMPACT";
      enabled?: boolean;
    }>(r);
    const tool = await updateMcpTool(id, body ?? {});
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "mcp.tool.updated",
      target: id,
      after: { enabled: tool.enabled, sensitivity: tool.sensitivity },
      correlationId,
    });
    return jsonOk({ tool });
  })(req);
}

// DELETE /api/mcp/tools/[id] — remove a tool definition.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const existing = await getMcpTool(id);
    if (!existing || existing.orgId !== ctx.orgId) throw notFound("Tool not found");
    await deleteMcpTool(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "mcp.tool.deleted",
      target: id,
      before: { name: existing.name },
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
