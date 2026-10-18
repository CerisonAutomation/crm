import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createHandoff, getHandoffs } from "@/lib/services/handoff";
import { validationFailed } from "@/lib/api-errors";

const PARTNER_TYPES = ["AUTHORITY", "PARTNER", "VENDOR"] as const;

// GET /api/handoffs?caseId=&status=&partnerType=
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const handoffs = await getHandoffs(ctx.orgId, {
      caseId: q.get("caseId") || undefined,
      status: q.get("status") || undefined,
      partnerType: q.get("partnerType") || undefined,
    });
    return jsonOk({ handoffs });
  })(req);
}

// POST /api/handoffs
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      partnerName?: string;
      partnerType?: string;
      documentRefs?: string[];
      notes?: string;
      caseId?: string;
    }>(r);
    if (!body?.partnerName) throw validationFailed("partnerName is required");
    if (!body?.partnerType) throw validationFailed("partnerType is required");
    if (!(PARTNER_TYPES as readonly string[]).includes(body.partnerType)) {
      throw validationFailed("partnerType must be AUTHORITY, PARTNER or VENDOR");
    }
    const handoff = await createHandoff({
      orgId: ctx.orgId,
      partnerName: body.partnerName,
      partnerType: body.partnerType as (typeof PARTNER_TYPES)[number],
      documentRefs: body.documentRefs,
      notes: body.notes,
      caseId: body.caseId,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "handoff.created",
      target: handoff.id,
      after: { partnerName: handoff.partnerName, partnerType: handoff.partnerType },
      correlationId,
    });
    return jsonOk({ handoff }, 201);
  })(req);
}
