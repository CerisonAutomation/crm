import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { buildIcs } from "@/lib/services/ics";
import { calendarLinks, icsDataUri, type CalendarEvent } from "@/lib/integrations/calendar-links";
import { contactActions } from "@/lib/integrations/phone";

export const dynamic = "force-dynamic";

type Kind = "booking" | "consultation";

/**
 * GET /api/calendar/event?type=booking|consultation&id=… — one event, ready for
 * every calendar: add-to-calendar deep links (Google live/office365, Outlook,
 * Yahoo), an inline `.ics`, and the phone actions (Call / Message / FaceTime /
 * WhatsApp) when a number is on file.
 *
 * Object-level authorisation is enforced per kind (client = own record only;
 * staff = own organisation).
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const params = new URL(r.url).searchParams;
    const type = (params.get("type") ?? "booking") as Kind;
    const id = params.get("id") ?? "";
    if (!id) throw new DomainError("id required", 400);

    let event: CalendarEvent;
    let uid: string;
    let phone: string | null = null;
    let partyName: string;
    let partyEmail: string | null = null;
    let organizerEmail: string | null = null;

    if (type === "booking") {
      const b = await db.booking.findUnique({
        where: { id },
        include: { case: { select: { orgId: true, clientId: true, reference: true, client: { select: { phone: true } } } } },
      });
      if (!b) throw new DomainError("Booking not found", 404);
      const clientOwns = b.clientId === ctx.userId || b.case?.clientId === ctx.userId;
      const staffOrg = b.case?.orgId === ctx.orgId;
      if (ctx.role === "CLIENT" ? !clientOwns : !staffOrg) throw new DomainError("Forbidden", 403);

      event = {
        title: `Citizen Lane — consultation${b.status === "CONFIRMED" ? " (confirmed)" : ""}`,
        start: b.startsAt,
        end: new Date(b.startsAt.getTime() + b.durationMin * 60_000),
        description: b.note ?? `Booking reference: ${b.slotId}`,
        location: "Citizen Lane — video call or office",
        timeZone: "Europe/Zurich",
      };
      uid = `booking-${b.id}@citizen-lane`;
      phone = b.case?.client?.phone ?? null;
      partyName = b.clientName;
      partyEmail = b.clientEmail;
    } else if (type === "consultation") {
      const c = await db.consultation.findUnique({ where: { id } });
      if (!c) throw new DomainError("Consultation not found", 404);
      if (ctx.role === "CLIENT" ? c.leadEmail !== ctx.email : c.orgId !== ctx.orgId) {
        throw new DomainError("Forbidden", 403);
      }
      event = {
        title: `Citizen Lane — ${c.programmeKey ? `${c.programmeKey} ` : ""}consultation`,
        start: c.scheduledAt,
        end: new Date(c.scheduledAt.getTime() + c.durationMin * 60_000),
        description: c.notes ?? "Consultation with your Citizen Lane relationship manager.",
        location: "Video call / Citizen Lane office",
        timeZone: "Europe/Zurich",
      };
      uid = `consultation-${c.id}@citizen-lane`;
      phone = c.leadPhone;
      partyName = c.leadName;
      partyEmail = c.leadEmail;
      organizerEmail = "info@citizen-lane.com";
    } else {
      throw new DomainError("type must be booking or consultation", 400);
    }

    const ics = buildIcs({
      uid,
      title: event.title,
      description: event.description,
      location: event.location,
      start: event.start,
      durationMin: Math.round((event.end.getTime() - event.start.getTime()) / 60_000),
      organizerName: "Citizen Lane",
      organizerEmail: organizerEmail ?? "info@citizen-lane.com",
      attendeeName: partyName,
      attendeeEmail: partyEmail ?? undefined,
      alarmMin: 60,
    });

    return jsonOk({
      type,
      id,
      event: {
        uid,
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        description: event.description ?? null,
        location: event.location ?? null,
        timeZone: event.timeZone ?? null,
      },
      links: calendarLinks(event),
      ics,
      icsDataUri: icsDataUri(ics),
      phone: phone ? contactActions(phone) : null,
    });
  })(req);
}
