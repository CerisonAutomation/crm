import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createKycCheck, getKycChecks } from "@/lib/services/kyc-check";
import { validationFailed } from "@/lib/api-errors";

const CHECK_TYPES = ["IDENTITY", "SANCTIONS", "PEP", "ADVERSE_MEDIA", "SOURCE_OF_FUNDS"] as const;

// GET /api/kyc-checks?caseId=&checkType=&status=
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const checks = await getKycChecks(ctx.orgId, {
      caseId: q.get("caseId") || undefined,
      checkType: q.get("checkType") || undefined,
      status: q.get("status") || undefined,
    });
    return jsonOk({ checks });
  })(req);
}

// POST /api/kyc-checks
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      checkType?: string;
      caseId?: string;
      provider?: string;
      providerRef?: string;
    }>(r);
    if (!body?.checkType) throw validationFailed("checkType is required");
    if (!(CHECK_TYPES as readonly string[]).includes(body.checkType)) {
      throw validationFailed("checkType is not a supported screening type");
    }
    const check = await createKycCheck({
      orgId: ctx.orgId,
      checkType: body.checkType as (typeof CHECK_TYPES)[number],
      caseId: body.caseId,
      provider: body.provider,
      providerRef: body.providerRef,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "kyc_check.created",
      target: check.id,
      after: { checkType: check.checkType, caseId: check.caseId ?? null },
      correlationId,
    });
    return jsonOk({ check }, 201);
  })(req);
}
