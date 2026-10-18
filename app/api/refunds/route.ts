import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createRefund, getRefunds } from "@/lib/services/refund";
import { validationFailed } from "@/lib/api-errors";

// GET /api/refunds?caseId=&status=
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const refunds = await getRefunds(ctx.orgId, {
      caseId: q.get("caseId") || undefined,
      status: q.get("status") || undefined,
    });
    return jsonOk({ refunds });
  })(req);
}

// POST /api/refunds
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      amountCents?: number;
      currency?: string;
      reason?: string;
      caseId?: string;
      paymentId?: string;
    }>(r);
    if (body?.amountCents === undefined) throw validationFailed("amountCents is required");
    if (!body?.reason) throw validationFailed("reason is required");
    const refund = await createRefund({
      orgId: ctx.orgId,
      amountCents: body.amountCents,
      currency: body.currency,
      reason: body.reason,
      caseId: body.caseId,
      paymentId: body.paymentId,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "refund.created",
      target: refund.id,
      after: { amountCents: refund.amountCents, reason: refund.reason },
      correlationId,
    });
    return jsonOk({ refund }, 201);
  })(req);
}
