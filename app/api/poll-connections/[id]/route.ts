import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import {
  deletePollConnection,
  getPollConnection,
  updatePollConnection,
} from "@/lib/services/poll-connection";
import { notFound } from "@/lib/api-errors";

async function ownedConnection(id: string, orgId: string) {
  const connection = await getPollConnection(id);
  if (!connection || connection.orgId !== orgId) throw notFound("Poll connection not found");
  return connection;
}

// GET /api/poll-connections/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const connection = await ownedConnection(id, ctx.orgId);
    return jsonOk({ connection });
  })(req);
}

// PATCH /api/poll-connections/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedConnection(id, ctx.orgId);
    const body = await readJson<{
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
    }>(r);
    const connection = await updatePollConnection(id, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "poll_connection.updated",
      target: connection.id,
      after: body,
      correlationId,
    });
    return jsonOk({ connection });
  })(req);
}

// DELETE /api/poll-connections/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedConnection(id, ctx.orgId);
    await deletePollConnection(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "poll_connection.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
