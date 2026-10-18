import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getMcpCall, completeMcpCall } from "@/lib/services/mcp-call";
import { notFound, validationFailed } from "@/lib/api-errors";

// PATCH /api/mcp/calls/[id] — record the execution result of a tool call.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const existing = await getMcpCall(id);
    if (!existing || existing.orgId !== ctx.orgId) throw notFound("Call not found");
    const body = await readJson<{
      status?: "SUCCEEDED" | "FAILED" | "DENIED";
      output?: string;
      error?: string;
      durationMs?: number;
    }>(r);
    if (!body?.status) throw validationFailed("status is required");
    const call = await completeMcpCall(id, {
      status: body.status,
      output: body.output,
      error: body.error,
      durationMs: body.durationMs,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "mcp.call.completed",
      target: id,
      after: { status: call.status },
      correlationId,
    });
    return jsonOk({ call });
  })(req);
}
