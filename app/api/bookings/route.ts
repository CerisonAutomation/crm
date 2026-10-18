import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { parseListParams, decodeCursor, nextPage } from "@/lib/pagination";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { bookSlot, listSlots } from "@/lib/services/bookings";

// GET /api/bookings — consultation slots (?days=15) or the caller's bookings (?mine=1).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const url = new URL(r.url);
    if (url.searchParams.get("mine") === "1") {
      const isStaff = ctx.role !== "CLIENT";
      // Every staff role — ADMIN included — only sees its own organisation's bookings.
      // Keyset pagination: `startsAt asc, id asc` with an opaque id cursor, so
      // the list is bounded without silently truncating a long booking history.
      // Default/max limit of 100 preserves the previous page-1 size.
      const { limit, cursor } = parseListParams(url, { defaultLimit: 100, maxLimit: 100 });
      const rows = await db.booking.findMany({
        where: isStaff ? { case: { orgId: ctx.orgId } } : { clientId: ctx.userId },
        include: { case: { select: { id: true, reference: true } } },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        ...(cursor ? { cursor: { id: decodeCursor(cursor) }, skip: 1 } : {}),
        take: limit + 1,
      });
      const page = nextPage(rows, limit, (b) => b.id);
      return jsonOk({ bookings: page.items, nextCursor: page.nextCursor });
    }
    const days = Math.min(Number(url.searchParams.get("days") ?? 15), 30);
    const slots = await listSlots(days);
    return jsonOk({ slots });
  })(req);
}

// POST /api/bookings — book a slot. CLIENT books on their own case; RM+ on any case.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "booking.create.own");
    const body = await readJson<{ slotId?: string; clientName?: string; clientEmail?: string; caseId?: string; note?: string; channel?: "PORTAL" | "PAGE" }>(r);
    if (!body.slotId || !body.clientName || !body.clientEmail) {
          throw new DomainError("slotId, clientName and clientEmail are required", 400);
        }
        let caseId: string | null = null;
        if (body.caseId) {
          const kase = await db.case.findUnique({ where: { id: body.caseId }, select: { id: true, clientId: true, orgId: true } });
          if (!kase) throw new DomainError("Case not found", 404);
          if (ctx.role === "CLIENT") {
            if (kase.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
          } else if (kase.orgId !== ctx.orgId) {
            // Staff (ADMIN included) may only book consultations on their own org's cases.
            throw new DomainError("Forbidden", 403);
          }
          caseId = kase.id;
        }
        const res = await bookSlot({
          slotId: body.slotId,
          clientName: body.clientName,
          clientEmail: body.clientEmail,
          clientId: ctx.userId,
          caseId,
          channel: body.channel ?? "PORTAL",
          note: body.note,
          actorLabel: ctx.name,
        });
        if (!res.ok) throw new DomainError(res.message, res.error === "SLOT_TAKEN" ? 409 : 400);
    await db.auditEvent.create({
      data: {
        orgId: ctx.orgId, actorLabel: ctx.name, action: "booking.created",
        target: res.bookingId, after: JSON.stringify({ startsAt: res.startsAt, caseId }),
      },
    }).catch(() => undefined);
    return jsonOk(res);
  })(req);
}
