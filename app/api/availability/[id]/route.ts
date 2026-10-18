import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteAvailability, getAvailability, updateAvailability } from "@/lib/services/availability";
import { notFound } from "@/lib/api-errors";

// A user only ever mutates their own availability slots.
async function ownedSlot(id: string, orgId: string, userId: string) {
  const slot = await getAvailability(id);
  if (!slot || slot.userId !== userId || slot.orgId !== orgId) {
    throw notFound("Availability slot not found");
  }
  return slot;
}

// PATCH /api/availability/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    await ownedSlot(id, ctx.orgId, ctx.userId);
    const body = await readJson<{
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      timezone?: string;
    }>(r);
    const slot = await updateAvailability(id, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "availability.updated",
      target: slot.id,
      after: body,
      correlationId,
    });
    return jsonOk({ availability: slot });
  })(req);
}

// DELETE /api/availability/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    await ownedSlot(id, ctx.orgId, ctx.userId);
    await deleteAvailability(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "availability.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
