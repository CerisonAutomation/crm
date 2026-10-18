import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteHandoff, getHandoff, updateHandoff } from "@/lib/services/handoff";
import { notFound } from "@/lib/api-errors";

async function ownedHandoff(id: string, orgId: string) {
  const handoff = await getHandoff(id);
  if (!handoff || handoff.orgId !== orgId) throw notFound("Handoff not found");
  return handoff;
}

// GET /api/handoffs/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const handoff = await ownedHandoff(id, ctx.orgId);
    return jsonOk({ handoff });
  })(req);
}

// PATCH /api/handoffs/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedHandoff(id, ctx.orgId);
    const body = await readJson<{
      status?: "PREPARED" | "SENT" | "ACKNOWLEDGED" | "COMPLETED";
      packageHash?: string;
      documentRefs?: string[];
      notes?: string;
    }>(r);
    const handoff = await updateHandoff(id, {
      status: body?.status,
      packageHash: body?.packageHash,
      documentRefs: body?.documentRefs,
      notes: body?.notes,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "handoff.updated",
      target: handoff.id,
      after: body,
      correlationId,
    });
    return jsonOk({ handoff });
  })(req);
}

// DELETE /api/handoffs/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedHandoff(id, ctx.orgId);
    await deleteHandoff(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "handoff.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
