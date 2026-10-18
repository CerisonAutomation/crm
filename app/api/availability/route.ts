import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createAvailability, getAvailabilities } from "@/lib/services/availability";
import { validationFailed } from "@/lib/api-errors";

// GET /api/availability?userId=&dayOfWeek= — user-scoped (defaults to the caller).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const q = new URL(r.url).searchParams;
    const dayParam = q.get("dayOfWeek");
    const availability = await getAvailabilities(ctx.orgId, {
      userId: q.get("userId") || ctx.userId,
      dayOfWeek: dayParam ? Number(dayParam) : undefined,
    });
    return jsonOk({ availability });
  })(req);
}

// POST /api/availability
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      timezone?: string;
      userId?: string;
    }>(r);
    if (body?.dayOfWeek === undefined) throw validationFailed("dayOfWeek is required");
    if (!body?.startTime) throw validationFailed("startTime is required");
    if (!body?.endTime) throw validationFailed("endTime is required");
    const slot = await createAvailability({
      orgId: ctx.orgId,
      userId: body.userId ?? ctx.userId,
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
      timezone: body.timezone,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "availability.created",
      target: slot.id,
      after: { userId: slot.userId, dayOfWeek: slot.dayOfWeek },
      correlationId,
    });
    return jsonOk({ availability: slot }, 201);
  })(req);
}
