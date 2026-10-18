import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteParty, getParty, updateParty } from "@/lib/services/party";
import { notFound } from "@/lib/api-errors";

async function ownedParty(id: string, orgId: string) {
  const party = await getParty(id);
  if (!party || party.orgId !== orgId) throw notFound("Party not found");
  return party;
}

// GET /api/parties/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const party = await ownedParty(id, ctx.orgId);
    return jsonOk({ party });
  })(req);
}

// PATCH /api/parties/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedParty(id, ctx.orgId);
    const body = await readJson<{
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
      status?: "ACTIVE" | "MERGED" | "ARCHIVED";
    }>(r);
    const party = await updateParty(id, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "party.updated",
      target: party.id,
      after: body,
      correlationId,
    });
    return jsonOk({ party });
  })(req);
}

// DELETE /api/parties/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedParty(id, ctx.orgId);
    await deleteParty(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "party.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
