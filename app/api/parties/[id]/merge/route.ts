import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getParty, mergeParties } from "@/lib/services/party";
import { notFound, validationFailed } from "@/lib/api-errors";

// POST /api/parties/[id]/merge — merge this party into `targetPartyId`.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const source = await getParty(id);
    if (!source || source.orgId !== ctx.orgId) throw notFound("Party not found");
    const body = await readJson<{ targetPartyId?: string; reason?: string }>(r);
    if (!body?.targetPartyId) throw validationFailed("targetPartyId is required");
    const target = await getParty(body.targetPartyId);
    if (!target || target.orgId !== ctx.orgId) throw notFound("Target party not found");
    const ledgerEntry = await mergeParties(source.id, target.id, ctx.userId, body.reason);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "party.merged",
      target: source.id,
      after: { targetPartyId: target.id, reason: body.reason ?? null },
      reason: body.reason,
      correlationId,
    });
    return jsonOk({ ledgerEntry });
  })(req);
}
