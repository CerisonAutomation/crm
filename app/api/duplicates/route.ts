import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getParty } from "@/lib/services/party";
import { createDuplicateCandidate, getDuplicateCandidates } from "@/lib/services/duplicate-candidate";
import { notFound, validationFailed } from "@/lib/api-errors";

// GET /api/duplicates?status= — duplicate-review queue for the caller's org.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const status = new URL(r.url).searchParams.get("status") || undefined;
    const duplicates = await getDuplicateCandidates(ctx.orgId, status);
    return jsonOk({ duplicates });
  })(req);
}

// POST /api/duplicates — record a candidate duplicate pair.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      partyId?: string;
      candidatePartyId?: string;
      score?: number;
    }>(r);
    if (!body?.partyId) throw validationFailed("partyId is required");
    if (!body?.candidatePartyId) throw validationFailed("candidatePartyId is required");
    if (body?.score === undefined) throw validationFailed("score is required");
    const party = await getParty(body.partyId);
    if (!party || party.orgId !== ctx.orgId) throw notFound("Party not found");
    const candidate = await getParty(body.candidatePartyId);
    if (!candidate || candidate.orgId !== ctx.orgId) throw notFound("Candidate party not found");
    const duplicate = await createDuplicateCandidate({
      orgId: ctx.orgId,
      partyId: party.id,
      candidatePartyId: candidate.id,
      score: body.score,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "duplicate.created",
      target: duplicate.id,
      after: { partyId: party.id, candidatePartyId: candidate.id, score: duplicate.score },
      correlationId,
    });
    return jsonOk({ duplicate }, 201);
  })(req);
}
