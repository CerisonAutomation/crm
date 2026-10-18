/**
 * Calendar feed — one subscribable calendar per user.
 *
 * Aggregates every dated commitment the platform holds for a person (bookings,
 * consultations, renewal deadlines, scheduled reminders) into a single RFC 5545
 * `.ics` document that Apple Calendar / macOS, Outlook, Google and any CalDAV
 * client can subscribe to.
 *
 * Subscribe flow (harvested from the `webcal://` convention used by spatie/
 * calendar-links and Apple's own "Subscribe to Calendar" UI):
 *   1. An authenticated caller requests their feed token (`GET /api/calendar`).
 *   2. The UI offers `<webcal://…/api/calendar/feed?u=<userId>&token=<token>>`.
 *   3. The client polls the http(s) URL; we serve `text/calendar`.
 *
 * Security: the feed token reuses the app's AUTH_SECRET-signed, EXPIRING token
 * scheme (`icsLinkToken` — 14-day TTL, fail-closed when AUTH_SECRET is unset).
 * A feed URL therefore grants read-only access to the owner's dates and nothing
 * else, and stops working when it lapses. The userId in the URL is not secret —
 * the signature is what authenticates the request.
 */
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";
import { icsDateTime, icsLinkToken, verifyIcsLinkToken } from "@/lib/services/ics";

/** Namespaced signing reference so a feed token can never be replayed as a consultation invite. */
function feedRef(userId: string): string {
  return `calendar-feed:${userId}`;
}

/** Mint the user's subscribe token (null when AUTH_SECRET is not configured). */
export function calendarFeedToken(userId: string): string | null {
  return icsLinkToken(feedRef(userId));
}

/** Verify a subscribe token for a given user. */
export function verifyCalendarFeedToken(userId: string, provided: string): boolean {
  return verifyIcsLinkToken(feedRef(userId), provided);
}

/** The relative feed path (the UI prefixes its own origin). */
export function calendarFeedPath(userId: string, token: string): string {
  return `/api/calendar/feed?u=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
}

// ── ICS emission (multi-event VCALENDAR) ──

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  return parts.join("\r\n");
}

type FeedEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string | null;
  location?: string | null;
  /** Minutes before start for the display alarm. */
  alarmMin?: number;
};

function vehicle(event: FeedEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${esc(event.uid)}`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    `DTSTART:${icsDateTime(event.start)}`,
    `DTEND:${icsDateTime(event.end)}`,
    `SUMMARY:${esc(event.title)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
  ];
  if (event.description) lines.push(fold(`DESCRIPTION:${esc(event.description)}`));
  if (event.location) lines.push(fold(`LOCATION:${esc(event.location)}`));
  if (event.alarmMin && event.alarmMin > 0) {
    lines.push("BEGIN:VALARM", `TRIGGER:-PT${event.alarmMin}M`, "ACTION:DISPLAY", `DESCRIPTION:${esc(event.title)}`, "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Collect the user's dated commitments from every source into feed events. */
export async function collectFeedEvents(userId: string): Promise<FeedEvent[]> {
  try {
    const [bookings, renewals, reminders, user] = await Promise.all([
      db.booking.findMany({
        where: {
          OR: [{ clientId: userId }, { case: { clientId: userId } }],
          status: { in: ["REQUESTED", "CONFIRMED"] },
        },
        orderBy: { startsAt: "asc" },
        take: 200,
      }),
      db.renewalReminder.findMany({
        where: { clientId: userId, status: { in: ["OPEN", "SCHEDULED"] } },
        orderBy: { dueAt: "asc" },
        take: 200,
      }),
      db.reminder.findMany({
        where: { clientId: userId, status: "SCHEDULED" },
        orderBy: { dueAt: "asc" },
        take: 200,
      }),
      db.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);

    const consultations = user
      ? await db.consultation.findMany({
          where: { leadEmail: user.email, status: { in: ["REQUESTED", "CONFIRMED"] } },
          orderBy: { scheduledAt: "asc" },
          take: 200,
        })
      : [];

    const events: FeedEvent[] = [];

    for (const b of bookings) {
      events.push({
        uid: `booking-${b.id}@citizen-lane`,
        title: b.status === "CONFIRMED" ? `Consultation (confirmed) — ${b.clientName}` : `Consultation (requested) — ${b.clientName}`,
        start: b.startsAt,
        end: new Date(b.startsAt.getTime() + b.durationMin * 60_000),
        description: b.note ?? `Booking reference: ${b.slotId}`,
        location: b.channel === "PAGE" ? "Online (Lane Page)" : "Citizen Lane — video call or office",
        alarmMin: 60,
      });
    }
    for (const c of consultations) {
      events.push({
        uid: `consultation-${c.id}@citizen-lane`,
        title: `Citizen Lane — ${c.programmeKey ? `${c.programmeKey} ` : ""}consultation`,
        start: c.scheduledAt,
        end: new Date(c.scheduledAt.getTime() + c.durationMin * 60_000),
        description: c.notes ?? null,
        location: "Video call / Citizen Lane office",
        alarmMin: 60,
      });
    }
    for (const r of renewals) {
      events.push({
        uid: `renewal-${r.id}@citizen-lane`,
        title: `Renewal deadline — ${r.title}`,
        start: r.dueAt,
        end: new Date(r.dueAt.getTime() + 30 * 60_000),
        description: r.notes ?? null,
        alarmMin: 0,
      });
    }
    for (const r of reminders) {
      events.push({
        uid: `reminder-${r.id}@citizen-lane`,
        title: r.title,
        start: r.dueAt,
        end: new Date(r.dueAt.getTime() + 30 * 60_000),
        description: r.detail ?? null,
        alarmMin: 15,
      });
    }

    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch (err) {
    throw new DomainError("Failed to collect calendar feed events", 500, { cause: err });
  }
}

/** Build the multi-event VCALENDAR document for a user. */
export async function buildUserCalendarFeed(userId: string, calendarName = "Citizen Lane"): Promise<{ ics: string; count: number }> {
  try {
    const events = await collectFeedEvents(userId);
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Citizen Lane//Schedule 1.0//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      fold(`X-WR-CALNAME:${esc(calendarName)}`),
      "X-WR-TIMEZONE:Europe/Zurich",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ];
    for (const event of events) lines.push(...vehicle(event));
    lines.push("END:VCALENDAR");
    return { ics: lines.join("\r\n") + "\r\n", count: events.length };
  } catch (err) {
    throw new DomainError("Failed to build calendar feed", 500, { cause: err });
  }
}
