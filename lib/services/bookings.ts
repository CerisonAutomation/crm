// Citizen Lane — Consultation Booking Service
// Slot generation (business days), booking creation with reminders, confirm/cancel.

import { db } from "@/lib/db";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { scheduleReminder } from "@/lib/services/reminders";
import { createHumanTask } from "@/lib/services/human-task";

export type Slot = {
  slotId: string;
  startsAt: string;
  durationMin: number;
  taken: boolean;
};

const SLOT_HOURS = [9, 11, 14, 16.5]; // 09:00, 11:00, 14:00, 16:30
const SLOT_MIN = 45;

function slotIdFor(d: Date): string {
  return `slot-${Math.floor(d.getTime() / 60_000)}`;
}

/** Next N business days × daily slot grid (skips weekends + taken slots). */
export async function listSlots(days = 15): Promise<Slot[]> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + (days + 2) * 86_400_000);
  const taken = await db.booking.findMany({
    where: {
      status: { in: ["REQUESTED", "CONFIRMED"] },
      startsAt: { gte: from, lte: to },
    },
    select: { slotId: true },
  });
  const takenSet = new Set(taken.map((t) => t.slotId));
  const slots: Slot[] = [];
  for (
    let i = 1;
    slots.length < days * SLOT_HOURS.length && i < days + 7;
    i++
  ) {
    const day = new Date(from.getTime() + i * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekend
    for (const h of SLOT_HOURS) {
      const startsAt = new Date(day.getTime());
      startsAt.setUTCMinutes(Math.round((h % 1) * 60), 0, 0);
      startsAt.setUTCHours(Math.floor(h));
      if (startsAt.getTime() < Date.now() + 2 * 3_600_000) continue; // ≥2h lead time
      const slotId = slotIdFor(startsAt);
      slots.push({
        slotId,
        startsAt: startsAt.toISOString(),
        durationMin: SLOT_MIN,
        taken: takenSet.has(slotId),
      });
    }
  }
  return slots;
}

export type BookInput = {
  slotId: string;
  clientName: string;
  clientEmail: string;
  clientId?: string | null;
  caseId?: string | null;
  channel?: "PORTAL" | "PAGE";
  note?: string;
  actorLabel?: string;
};

export type BookResult =
  | { ok: true; bookingId: string; startsAt: string; status: string }
  | {
      ok: false;
      error: "SLOT_TAKEN" | "SLOT_INVALID" | "CASE_NOT_FOUND";
      message: string;
    };

export async function bookSlot(input: BookInput): Promise<BookResult> {
  const startsAt = new Date(Number(input.slotId.replace("slot-", "")) * 60_000);
  if (
    input.slotId.startsWith("slot-") &&
    Number.isFinite(startsAt.getTime()) &&
    startsAt.getTime() > Date.now()
  ) {
    // valid shape
  } else {
    return { ok: false, error: "SLOT_INVALID", message: "Unknown slot." };
  }
  const slotId = slotIdFor(startsAt);
  try {
    const booking = await db.booking.create({
      data: {
        slotId,
        startsAt,
        durationMin: SLOT_MIN,
        status: "REQUESTED",
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        clientId: input.clientId ?? null,
        caseId: input.caseId ?? null,
        channel: input.channel ?? "PORTAL",
        note: input.note ?? null,
      },
    });
    // T-24h reminder
    await scheduleReminder({
      caseId: booking.caseId,
      clientId: booking.clientId,
      kind: "BOOKING_UPCOMING",
      title: "Consultation tomorrow — reminder",
      detail: `Consultation with ${booking.clientName}`,
      dueAt: new Date(startsAt.getTime() - 24 * 3_600_000),
      audience: "BOTH",
      dedupeKey: `bk24:${booking.id}`,
      metadata: { bookingId: booking.id },
    });
    if (booking.caseId) {
      emitCaseEvent("booking.created", {
        caseId: booking.caseId,
        actorLabel: input.actorLabel ?? booking.clientName,
        meta: { bookingId: booking.id, startsAt: startsAt.toISOString() },
        dedupeKey: `bk:${booking.id}`,
      }).catch(() => undefined);
    }
    return {
      ok: true,
      bookingId: booking.id,
      startsAt: startsAt.toISOString(),
      status: booking.status,
    };
  } catch {
    return {
      ok: false,
      error: "SLOT_TAKEN",
      message: "This slot was just booked — pick another.",
    };
  }
}

export type BookingAction = "CONFIRM" | "CANCEL" | "NO_SHOW";

/**
 * Confirm/cancel a booking on behalf of `orgId` (the acting staff member's
 * organisation). Tenant isolation is enforced here — a booking whose case
 * belongs to another organisation (or, for case-less portal bookings, whose
 * client does) is reported as NOT_FOUND rather than acted on.
 */
export async function decideBooking(
  bookingId: string,
  action: BookingAction,
  actorLabel: string,
  reason: string | undefined,
  orgId: string
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      caseId: true,
      clientId: true,
      clientName: true,
      status: true,
      startsAt: true,
      case: { select: { orgId: true } },
    },
  });
  if (!booking) return { ok: false, error: "NOT_FOUND" };
  const ownerOrg =
    booking.case?.orgId ??
    (booking.clientId
      ? (
          await db.user.findUnique({
            where: { id: booking.clientId },
            select: { orgId: true },
          })
        )?.orgId ?? null
      : null);
  if (ownerOrg !== orgId) return { ok: false, error: "NOT_FOUND" };
  if (
    booking.status === "CANCELLED" ||
    booking.status === "COMPLETED" ||
    booking.status === "NO_SHOW"
  )
    return { ok: false, error: "IMMUTABLE" };
  // NO_SHOW marks a confirmed booking the client never attended — only a
  // CONFIRMED booking can no-show (a REQUESTED hold is cancelled instead).
  if (action === "NO_SHOW" && booking.status !== "CONFIRMED")
    return { ok: false, error: "BAD_STATE" };
  const status =
    action === "CONFIRM"
      ? "CONFIRMED"
      : action === "NO_SHOW"
      ? "NO_SHOW"
      : "CANCELLED";
  // Slot-release parity (§24.8): CANCEL and NO_SHOW share the close-out —
  // reminders off, tombstone kept (except the M2 hold delete), event emitted.
  const closeOut = action !== "CONFIRM";
  // M2 hold release: a never-confirmed REQUESTED booking is a hold, not history —
  // cancelling it deletes the row (frees the slot, no tombstone accumulation).
  // A CONFIRMED booking keeps its CANCELLED tombstone for the record.
  // Reminders + the booking.cancelled event below still run off the in-memory
  // row, so the audit/event trail keeps its matching close.
  if (action === "CANCEL" && booking.status === "REQUESTED") {
    await db.booking.delete({ where: { id: bookingId } });
  } else {
    await db.booking.update({
      where: { id: bookingId },
      // Cancellation reason stored on the tombstone (the M2-deleted hold keeps
      // its reason in the audit/event payloads, which still run below).
      data: closeOut ? { status, cancelReason: reason ?? null } : { status },
    });
  }
  if (closeOut) {
    await db.reminder.updateMany({
      where: { dedupeKey: { startsWith: `bk24:${bookingId}` } },
      data: { status: "CANCELLED" },
    });
    // also cancel the generated-by-sweeper variant if present — metadata is a
    // JSON object ({ bookingId }), so compare against the object, not its
    // stringified form (the previous JSON.stringify comparison never matched).
    await db.reminder
      .updateMany({
        where: {
          metadata: { equals: { bookingId } },
          status: "SCHEDULED",
          kind: "BOOKING_UPCOMING",
        },
        data: { status: "CANCELLED" },
      })
      .catch(() => undefined);
  }
  // NO_SHOW follow-up (§24.8): a missed consultation always leaves a task for
  // the desk — reschedule, never silent. Unassigned: the desk triages the queue.
  if (action === "NO_SHOW") {
    await createHumanTask({
      orgId,
      caseId: booking.caseId ?? undefined,
      title: "Client missed consultation — reschedule",
      description: `${
        booking.clientName
      } did not attend the consultation scheduled for ${booking.startsAt.toISOString()} (booking ${bookingId}). Recorded reason: ${
        reason ?? "none"
      }.`,
      priority: "HIGH",
      dueDate: new Date(Date.now() + 2 * 86_400_000),
    });
  }
  if (booking.caseId) {
    emitCaseEvent(
      action === "CONFIRM"
        ? "booking.confirmed"
        : action === "NO_SHOW"
        ? "booking.no-show"
        : "booking.cancelled",
      {
        caseId: booking.caseId,
        actorLabel,
        meta: {
          bookingId,
          startsAt: booking.startsAt.toISOString(),
          reason: reason ?? null,
        },
        // S1 deterministic dedupe: no random suffix — a retried decide replays
        // the same key and the hub suppresses the duplicate fan-out instead of
        // notifying twice.
        dedupeKey: `${action.toLowerCase()}:${booking.id}`,
      }
    ).catch(() => undefined);
  }
  return { ok: true, status };
}
