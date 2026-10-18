import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import {
  deleteProgrammeRequirement,
  getProgrammeRequirement,
  updateProgrammeRequirement,
} from "@/lib/services/programme-requirement";
import { notFound } from "@/lib/api-errors";

// The requirement must belong to the programme in the URL path.
async function ownedRequirement(programmeId: string, reqId: string) {
  const requirement = await getProgrammeRequirement(reqId);
  if (!requirement || requirement.programmeId !== programmeId) {
    throw notFound("Programme requirement not found");
  }
  return requirement;
}

// PATCH /api/programmes/[id]/requirements/[reqId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> },
) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id, reqId } = await params;
    await ownedRequirement(id, reqId);
    const body = await readJson<{
      title?: string;
      description?: string;
      windowDays?: number;
      appliesTo?: "PRIMARY" | "SPOUSE" | "CHILD" | "ALL";
      apostille?: boolean;
      translation?: boolean;
    }>(r);
    const requirement = await updateProgrammeRequirement(reqId, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "programme_requirement.updated",
      target: requirement.id,
      after: body,
      correlationId,
    });
    return jsonOk({ requirement });
  })(req);
}

// DELETE /api/programmes/[id]/requirements/[reqId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> },
) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id, reqId } = await params;
    await ownedRequirement(id, reqId);
    await deleteProgrammeRequirement(reqId);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "programme_requirement.deleted",
      target: reqId,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
