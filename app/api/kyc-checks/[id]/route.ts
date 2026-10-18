import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteKycCheck, getKycCheck, updateKycCheck } from "@/lib/services/kyc-check";
import { notFound } from "@/lib/api-errors";

async function ownedCheck(id: string, orgId: string) {
  const check = await getKycCheck(id);
  if (!check || check.orgId !== orgId) throw notFound("KYC check not found");
  return check;
}

// GET /api/kyc-checks/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const check = await ownedCheck(id, ctx.orgId);
    return jsonOk({ check });
  })(req);
}

// PATCH /api/kyc-checks/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedCheck(id, ctx.orgId);
    const body = await readJson<{
      status?: "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED" | "REVIEW";
      result?: string;
      riskScore?: number;
      reviewedBy?: string;
      notes?: string;
    }>(r);
    const check = await updateKycCheck(id, {
      status: body?.status,
      result: body?.result,
      riskScore: body?.riskScore,
      reviewedBy: body?.reviewedBy,
      notes: body?.notes,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "kyc_check.updated",
      target: check.id,
      after: body,
      correlationId,
    });
    return jsonOk({ check });
  })(req);
}

// DELETE /api/kyc-checks/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedCheck(id, ctx.orgId);
    await deleteKycCheck(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "kyc_check.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
