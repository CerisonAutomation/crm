import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteRefund, getRefund, updateRefund } from "@/lib/services/refund";
import { notFound } from "@/lib/api-errors";

async function ownedRefund(id: string, orgId: string) {
  const refund = await getRefund(id);
  if (!refund || refund.orgId !== orgId) throw notFound("Refund not found");
  return refund;
}

// GET /api/refunds/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const refund = await ownedRefund(id, ctx.orgId);
    return jsonOk({ refund });
  })(req);
}

// PATCH /api/refunds/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedRefund(id, ctx.orgId);
    const body = await readJson<{
      status?: "PENDING" | "APPROVED" | "REJECTED" | "PROCESSED";
      processedBy?: string;
    }>(r);
    const refund = await updateRefund(id, {
      status: body?.status,
      processedBy: body?.processedBy,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "refund.updated",
      target: refund.id,
      after: body,
      correlationId,
    });
    return jsonOk({ refund });
  })(req);
}

// DELETE /api/refunds/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedRefund(id, ctx.orgId);
    await deleteRefund(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "refund.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
