import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { decideBooking } from "@/lib/services/bookings";

// POST /api/bookings/[id] — CONFIRM | CANCEL | NO_SHOW (RM/SENIOR_RM/ADMIN; booking.manage).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "booking.manage");
    const { id } = await params;
    const body = await readJson<{
      action?: "CONFIRM" | "CANCEL" | "NO_SHOW";
      reason?: string;
    }>(r);
    if (
      body.action !== "CONFIRM" &&
      body.action !== "CANCEL" &&
      body.action !== "NO_SHOW"
    ) {
      throw new DomainError("action must be CONFIRM, CANCEL or NO_SHOW", 400);
    }
    const res = await decideBooking(
      id,
      body.action,
      ctx.name,
      body.reason,
      ctx.orgId
    );
    if (!res.ok) {
      const status = res.error === "NOT_FOUND" ? 404 : 409;
      throw new DomainError(
        res.error === "NOT_FOUND"
          ? "Booking not found"
          : res.error === "BAD_STATE"
          ? "Only a confirmed booking can be marked no-show"
          : "Booking already closed",
        status
      );
    }
    await db.auditEvent
      .create({
        data: {
          orgId: ctx.orgId,
          actorLabel: ctx.name,
          action: `booking.${body.action.toLowerCase()}`,
          target: id,
          after: JSON.stringify({
            status: res.status,
            reason: body.reason ?? null,
          }),
        },
      })
      .catch(() => undefined);
    return jsonOk({ ok: true, status: res.status });
  })(req);
}
