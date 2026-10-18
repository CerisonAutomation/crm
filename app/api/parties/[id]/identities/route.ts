import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getParty } from "@/lib/services/party";
import { createExternalIdentity, getExternalIdentities } from "@/lib/services/external-identity";
import { notFound, validationFailed } from "@/lib/api-errors";

// GET /api/parties/[id]/identities — identities linked to this party.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const party = await getParty(id);
    if (!party || party.orgId !== ctx.orgId) throw notFound("Party not found");
    const identities = await getExternalIdentities(party.id);
    return jsonOk({ identities });
  })(req);
}

// POST /api/parties/[id]/identities — link an external identity to this party.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const party = await getParty(id);
    if (!party || party.orgId !== ctx.orgId) throw notFound("Party not found");
    const body = await readJson<{
      provider?: string;
      externalId?: string;
      confidence?: number;
      source?: "MANUAL" | "IMPORT" | "MERGE";
    }>(r);
    if (!body?.provider) throw validationFailed("provider is required");
    if (!body?.externalId) throw validationFailed("externalId is required");
    const identity = await createExternalIdentity({
      partyId: party.id,
      provider: body.provider,
      externalId: body.externalId,
      confidence: body.confidence,
      source: body.source,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "party.identity.created",
      target: identity.id,
      after: { partyId: party.id, provider: identity.provider },
      correlationId,
    });
    return jsonOk({ identity }, 201);
  })(req);
}
