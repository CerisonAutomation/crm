// Citizen Lane — Reminder Engine
// Deadline ledger for every statutory/practical deadline in the service lifecycle:
// document request due dates, OCR-detected document expiries, case staleness,
// consultation T-24h reminders, dispatch follow-ups + escalation ladder.
// Sweeper: HMR-safe singleton interval + catch-up on boot (mirrors webhooks.ts).

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { audit } from "@/lib/api-helpers";
import { notifyUser } from "@/lib/services/notify";
import { isServerless } from "@/lib/deployment";
import {
  noteSweeperRun,
  sweepOverlapCountSinceBoot,
} from "@/lib/automation/scheduler";
import { sweepDunning } from "@/lib/services/dunning";
import {
  escalateOverdueThreads,
  rfiService,
} from "@/lib/adapters/prisma-rfi-store";
import { fieldEncryption } from "@/lib/adapters/field-encryption";
import { shouldEncryptField } from "@/lib/ports/field-encryption";

export type ReminderKind =
  | "REQUEST_DUE"
  | "DOC_EXPIRY"
  | "CASE_STALE"
  | "BOOKING_UPCOMING"
  | "FOLLOWUP_DUE"
  | "RFI_OVERDUE"
  | "COMPLIANCE"
  | "CUSTOM";

const DAY = 86_400_000;

export type ScheduleReminderInput = {
  caseId?: string | null;
  clientId?: string | null;
  kind: ReminderKind;
  title: string;
  detail?: string;
  dueAt: Date;
  audience?: "CLIENT" | "RM" | "BOTH";
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

/** Idempotently schedule a reminder; emits reminder.created on first insert. */
export async function scheduleReminder(
  input: ScheduleReminderInput
): Promise<{ created: boolean; reminderId: string | null }> {
  const existing = await db.reminder
    .findUnique({ where: { dedupeKey: input.dedupeKey } })
    .catch(() => null);
  if (existing) return { created: false, reminderId: existing.id };
  const row = await db.reminder
    .create({
      data: {
        caseId: input.caseId ?? null,
        clientId: input.clientId ?? null,
        kind: input.kind,
        title: input.title,
        detail: input.detail ?? null,
        dueAt: input.dueAt,
        audience: input.audience ?? "RM",
        dedupeKey: input.dedupeKey,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
    .catch(() => null);
  if (!row) return { created: false, reminderId: null };
  if (row.caseId) {
    emitCaseEvent("reminder.created", {
      caseId: row.caseId,
      actorLabel: "Reminder engine",
      meta: {
        kind: row.kind,
        reminderTitle: row.title,
        dueAt: row.dueAt.toISOString(),
        reminderId: row.id,
      },
      dedupeKey: row.dedupeKey,
    }).catch(() => undefined);
  }
  return { created: true, reminderId: row.id };
}

const fire = async (
  reminderId: string,
  caseId: string | null,
  kind: string,
  title: string,
  dueAt: Date,
  extra: Record<string, unknown> = {}
) => {
  await db.reminder
    .update({
      where: { id: reminderId },
      data: { status: "FIRED", firedAt: new Date() },
    })
    .catch(() => undefined);
  if (caseId) {
    // Document expiries get their own rich topic (renewal instructions for the
    // client, renewal-request brief for staff); everything else is reminder.due.
    const topic = kind === "DOC_EXPIRY" ? "document.expiring" : "reminder.due";
    emitCaseEvent(topic, {
      caseId,
      actorLabel: "Reminder engine",
      meta: {
        kind,
        reminderTitle: title,
        dueAt: dueAt.toISOString(),
        reminderId,
        ...extra,
      },
      dedupeKey: `fired:${reminderId}`,
    }).catch(() => undefined);
  }
};

/**
 * One sweep pass:
 *  1. generate REQUEST_DUE reminders for open document requests (due date − 7d and at due date)
 *  2. fire reminders whose dueAt passed; flip overdue document requests to OVERDUE
 *  3. generate + fire DOC_EXPIRY reminders from OCR dateOfExpiry fields (60/30/7 days)
 *  4. generate + fire CASE_STALE nudges (14d / 30d idle)
 *  5. generate + fire BOOKING_UPCOMING reminders (T-24h)
 *  6. escalate FOLLOWUP_DUE dispatch follow-ups
 *  6b. escalate breached RFI threads (ADR-005) via RFI_OVERDUE reminders
 *  7. fire generic due reminders (CUSTOM / COMPLIANCE / FOLLOWUP_DUE) to their audience
 *  8. escalate FIRED reminders
 * 9. flip past-due SENT invoices to OVERDUE (dunning)
 * 10. fire confirmed renewal obligations (ADR-006 aftercare track)
 */
export async function sweepReminders(): Promise<{
  fired: number;
  created: number;
  escalated: number;
  flipped: number;
}> {
  const now = new Date();
  const nowMs = now.getTime();
  let fired = 0;
  let created = 0;
  let escalated = 0;
  let flipped = 0;

  // 1+2. document-request deadlines
  const openRequests = await db.documentRequest.findMany({
    where: { status: "OPEN", dueDate: { not: null } },
    select: { id: true, caseId: true, title: true, dueDate: true },
  });
  for (const r of openRequests) {
    if (!r.dueDate) continue;
    const due7 = new Date(r.dueDate.getTime() - 7 * DAY);
    for (const [key, at, label] of [
      [`reqdue7:${r.id}`, due7, `${r.title} — due in 7 days`],
      [`reqdue:${r.id}`, r.dueDate, `${r.title} — due now`],
    ] as const) {
      if (at.getTime() > nowMs) {
        const res = await scheduleReminder({
          caseId: r.caseId,
          kind: "REQUEST_DUE",
          title: label,
          detail: `Document request deadline`,
          dueAt: at,
          audience: "BOTH",
          dedupeKey: key,
          metadata: { requestId: r.id },
        });
        if (res.created) created++;
      } else {
        const row = await db.reminder
          .findUnique({ where: { dedupeKey: key } })
          .catch(() => null);
        if (row && row.status === "SCHEDULED") {
          await fire(row.id, r.caseId, "REQUEST_DUE", label, r.dueDate);
          fired++;
        }
      }
    }
  }
  // flip long-overdue requests to OVERDUE (letter template prints "(overdue)")
  const overdueOpen = openRequests.filter(
    (r) => r.dueDate && r.dueDate.getTime() < nowMs - 5_000
  );
  for (const r of overdueOpen) {
    const res = await db.documentRequest.updateMany({
      where: { id: r.id, status: "OPEN" },
      data: { status: "OVERDUE" },
    });
    flipped += res.count;
  }

  // 3. document expiry watch (OCR-extracted dates). Keyset pages (id ASC,
  // 500/page) instead of one unbounded read — the extractedField table grows
  // with every document, and a full-table sweep starves the shared sweep.
  const EXPIRY_PAGE = 500;
  let expiryCursor: string | null = null;
  for (;;) {
    const expiries = await db.extractedField.findMany({
      where: {
        fieldKey: "dateOfExpiry",
        value: { not: null },
        ...(expiryCursor ? { id: { gt: expiryCursor } } : {}),
      },
      select: {
        id: true,
        documentId: true,
        value: true,
        document: {
          select: {
            id: true,
            caseId: true,
            title: true,
            status: true,
            case: { select: { orgId: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: EXPIRY_PAGE,
    });
    if (expiries.length === 0) break;
    for (const f of expiries) {
      const doc = f.document;
      if (!doc?.caseId || doc.status === "REJECTED") continue;
      // FIELD-ENC: open the sealed date and re-seal on read when rotated, so
      // rows migrate without a flag day. Unopenable rows are skipped loudly
      // AND audited — tamper vs rotation stays distinguishable in the trail.
      let raw = f.value ?? "";
      if (shouldEncryptField("dateOfExpiry") && fieldEncryption.isSealed(raw)) {
        const orgId = doc.case?.orgId ?? "";
        try {
          raw = fieldEncryption.open(orgId, raw);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(
            "[reminders] cannot open sealed expiry for document",
            doc.id,
            reason
          );
          await audit({
            orgId: doc.case?.orgId ?? null,
            action: "field.decrypt_failed",
            target: doc.id,
            reason,
          });
          continue;
        }
        if (fieldEncryption.needsReseal(f.value ?? "")) {
          const resealed = fieldEncryption.seal(orgId, "dateOfExpiry", raw);
          await db.extractedField
            .update({ where: { id: f.id }, data: { value: resealed } })
            .catch(() => undefined);
        }
      }
      const expiry = new Date(raw);
      if (Number.isNaN(expiry.getTime())) continue;
      const daysLeft = Math.ceil((expiry.getTime() - nowMs) / DAY);
      if (daysLeft > 60 || daysLeft < 0) continue;
      // tightest applicable threshold (60 → 30 → 7 as the expiry approaches)
      const applicable = ([60, 30, 7] as const).filter((t) => daysLeft <= t);
      const threshold = applicable[applicable.length - 1];
      const key = `docexp:${doc.id}:${threshold}`;
      const at = new Date(expiry.getTime() - threshold * DAY);
      const row = await db.reminder
        .findUnique({ where: { dedupeKey: key } })
        .catch(() => null);
      if (row && row.status === "SCHEDULED" && at.getTime() <= nowMs) {
        await fire(
          row.id,
          doc.caseId,
          "DOC_EXPIRY",
          `${doc.title} expires ${
            threshold <= 7 ? "within a week" : `in ~${threshold} days`
          }`,
          expiry,
          { documentId: doc.id, daysLeft, documentLabel: doc.title }
        );
        fired++;
      } else if (!row) {
        const res = await scheduleReminder({
          caseId: doc.caseId,
          kind: "DOC_EXPIRY",
          title: `${doc.title} — expires in ≤ ${threshold} days`,
          detail: "OCR expiry watch",
          dueAt: at > now ? at : now,
          audience: "BOTH",
          dedupeKey: key,
          metadata: { documentId: doc.id, threshold },
        });
        if (res.created) created++;
        if (at.getTime() <= nowMs && res.reminderId) {
          await fire(
            res.reminderId,
            doc.caseId,
            "DOC_EXPIRY",
            `${doc.title} expires ${
              threshold <= 7 ? "within a week" : `in ~${threshold} days`
            }`,
            expiry,
            { documentId: doc.id, daysLeft, documentLabel: doc.title }
          );
          fired++;
        }
      }
    }
    if (expiries.length < EXPIRY_PAGE) break;
    expiryCursor = expiries[expiries.length - 1].id;
  }

  // 4. staleness nudges
  const stale = await db.case.findMany({
    where: {
      status: { in: ["DOCS_REQUESTED", "IN_PROGRESS", "FOLLOW_UP"] },
      updatedAt: { lt: new Date(nowMs - 14 * DAY) },
    },
    select: { id: true, updatedAt: true },
  });
  for (const c of stale) {
    const idleDays = Math.floor((nowMs - c.updatedAt.getTime()) / DAY);
    const threshold = idleDays >= 30 ? 30 : 14;
    const key = `stale:${c.id}:${threshold}`;
    const row = await db.reminder
      .findUnique({ where: { dedupeKey: key } })
      .catch(() => null);
    const at = new Date(c.updatedAt.getTime() + threshold * DAY);
    if (row && row.status === "SCHEDULED" && at.getTime() <= nowMs) {
      await fire(
        row.id,
        c.id,
        "CASE_STALE",
        `Case idle ${idleDays} days — follow up`,
        at,
        { idleDays }
      );
      fired++;
    } else if (!row) {
      const res = await scheduleReminder({
        caseId: c.id,
        kind: "CASE_STALE",
        title: `Case idle ${threshold}+ days — nudge required`,
        detail: "Inactivity watchdog",
        dueAt: at > now ? at : now,
        audience: "RM",
        dedupeKey: key,
        metadata: { threshold },
      });
      if (res.created) created++;
    }
  }

  // 5. booking T-24h reminders
  const bookings = await db.booking.findMany({
    where: {
      status: { in: ["REQUESTED", "CONFIRMED"] },
      startsAt: { gt: now, lt: new Date(nowMs + 36 * 3_600_000) },
    },
    select: { id: true, caseId: true, clientId: true, startsAt: true },
  });
  for (const b of bookings) {
    const key = `bk24:${b.id}`;
    const at = new Date(b.startsAt.getTime() - 24 * 3_600_000);
    const row = await db.reminder
      .findUnique({ where: { dedupeKey: key } })
      .catch(() => null);
    if (row && row.status === "SCHEDULED" && at.getTime() <= nowMs) {
      await fire(
        row.id,
        b.caseId,
        "BOOKING_UPCOMING",
        "Consultation within 24 hours",
        b.startsAt,
        { bookingId: b.id }
      );
      fired++;
    } else if (!row) {
      const res = await scheduleReminder({
        caseId: b.caseId,
        clientId: b.clientId,
        kind: "BOOKING_UPCOMING",
        title: "Consultation tomorrow — reminder",
        detail: "T-24h consultation reminder",
        dueAt: at > now ? at : now,
        audience: "BOTH",
        dedupeKey: key,
        metadata: { bookingId: b.id },
      });
      if (res.created) created++;
    }
  }

  // 6. dispatch follow-ups due
  const dueFollowUps = await db.followUp.findMany({
    where: { status: "SCHEDULED", dueDate: { lt: now } },
    select: { id: true, caseId: true, note: true, dueDate: true },
    take: 50,
  });
  for (const f of dueFollowUps) {
    await db.followUp
      .update({ where: { id: f.id }, data: { status: "ESCALATED" } })
      .catch(() => undefined);
    escalated++;
    // A due authority follow-up must actually reach someone. Flipping the status
    // alone chased nobody, so the case silently stalled. Filed as a FOLLOWUP_DUE
    // reminder (idempotent by dedupeKey) so it rides the same delivery path as
    // every other deadline — step 7 below, which resolves the case's RM team and
    // falls back to the org RM pool — instead of inventing a second notifier.
    const res = await scheduleReminder({
      caseId: f.caseId,
      kind: "FOLLOWUP_DUE",
      title: "Authority follow-up due",
      detail: f.note ?? "Chase the authority for a decision on this case.",
      dueAt: now,
      audience: "RM",
      dedupeKey: `followup:${f.id}`,
      metadata: { followUpId: f.id },
    });
    if (res.created) created++;
  }

  // 6b. RFI SLA breaches (ADR-005): OPEN threads past their answer clock flip
  // to ESCALATED with a SYSTEM turn and an audit row, then ride the same
  // delivery path as every other deadline — an RFI_OVERDUE reminder to the
  // accountable owner (falling back to the case team, then the org RM pool).
  // The state move lives in the RFI use case; this sweep only delivers it.
  try {
    const breached = await escalateOverdueThreads(
      rfiService(),
      "reminder-sweep:" + now.toISOString()
    );
    for (const item of breached) {
      try {
        const res = await scheduleReminder({
          caseId: item.caseId,
          kind: "RFI_OVERDUE",
          title: "RFI answer overdue — chase the client",
          detail:
            "An RFI thread passed its answer clock and escalated to the RM queue.",
          dueAt: now,
          audience: "RM",
          dedupeKey: "rfi-sla:" + item.threadId,
          metadata: { threadId: item.threadId, ownerId: item.ownerId },
        });
        if (res.created) created++;
        const kase = await db.case
          .findUnique({ where: { id: item.caseId }, select: { orgId: true } })
          .catch(() => null);
        const staffIds = new Set<string>();
        if (item.ownerId) staffIds.add(item.ownerId);
        const assignments = await db.caseAssignment
          .findMany({
            where: { caseId: item.caseId },
            select: { userId: true },
          })
          .catch(() => []);
        for (const a of assignments) staffIds.add(a.userId);
        if (staffIds.size === 0 && kase) {
          const pool = await db.user
            .findMany({
              where: {
                orgId: kase.orgId,
                status: "ACTIVE",
                role: { in: ["RM", "SENIOR_RM"] },
              },
              select: { id: true },
            })
            .catch(() => []);
          for (const u of pool) staffIds.add(u.id);
        }
        for (const staffId of staffIds) {
          await notifyUser({
            userId: staffId,
            category: "CASE",
            title: "RFI answer overdue — chase the client",
            body: "An RFI thread passed its answer clock and escalated to the RM queue.",
            caseId: item.caseId,
          }).catch(() => undefined);
        }
        escalated++;
      } catch (err) {
        console.error(
          "[reminders] rfi escalation " + item.threadId + " failed",
          err
        );
      }
    }
  } catch (err) {
    console.error("[reminders] rfi escalation sweep failed", err);
  }

  // 7. generic due reminders — CUSTOM / COMPLIANCE / FOLLOWUP_DUE fired to their
  // audience (client and/or the case's RM team, falling back to the org RM pool).
  // Per-reminder work is isolated so one bad row can never abort the sweep.
  const dueGeneric = await db.reminder.findMany({
    where: {
      status: "SCHEDULED",
      dueAt: { lte: now },
      kind: { in: ["CUSTOM", "COMPLIANCE", "FOLLOWUP_DUE"] },
    },
    select: {
      id: true,
      caseId: true,
      clientId: true,
      title: true,
      detail: true,
      audience: true,
    },
    take: 50,
  });
  for (const rem of dueGeneric) {
    try {
      const kase = rem.caseId
        ? await db.case.findUnique({
            where: { id: rem.caseId },
            select: { id: true, orgId: true, clientId: true },
          })
        : null;
      const clientId = rem.clientId ?? kase?.clientId ?? null;
      if (!clientId && !kase) continue; // neither a client nor a case — nothing to deliver
      await db.reminder.update({
        where: { id: rem.id },
        data: { status: "FIRED", firedAt: new Date() },
      });
      const body = rem.detail ?? rem.title;
      if (clientId && (rem.audience === "CLIENT" || rem.audience === "BOTH")) {
        await notifyUser({
          userId: clientId,
          category: "CASE",
          title: rem.title,
          body,
          caseId: rem.caseId ?? undefined,
        });
      }
      if (kase && (rem.audience === "RM" || rem.audience === "BOTH")) {
        const assignments = await db.caseAssignment.findMany({
          where: { caseId: kase.id },
          select: { userId: true },
        });
        let staffIds = assignments.map((a) => a.userId);
        if (staffIds.length === 0) {
          const pool = await db.user.findMany({
            where: {
              orgId: kase.orgId,
              status: "ACTIVE",
              role: { in: ["RM", "SENIOR_RM"] },
            },
            select: { id: true },
          });
          staffIds = pool.map((u) => u.id);
        }
        for (const staffId of staffIds) {
          await notifyUser({
            userId: staffId,
            category: "CASE",
            title: rem.title,
            body,
            caseId: kase.id,
          });
        }
      }
      fired++;
    } catch (err) {
      console.error(`[reminders] due reminder ${rem.id} failed`, err);
    }
  }

  // 8. escalation ladder — FIRED reminders unresolved for 3 days
  const staleFired = await db.reminder.findMany({
    where: {
      status: "FIRED",
      kind: { in: ["REQUEST_DUE", "DOC_EXPIRY", "CASE_STALE"] },
      firedAt: { lt: new Date(nowMs - 3 * DAY) },
    },
    select: { id: true, caseId: true, kind: true, title: true, dueAt: true },
    take: 50,
  });
  for (const r of staleFired) {
    await db.reminder
      .update({
        where: { id: r.id },
        data: { status: "ESCALATED", escalatedAt: new Date() },
      })
      .catch(() => undefined);
    if (r.caseId) {
      emitCaseEvent("reminder.escalated", {
        caseId: r.caseId,
        actorLabel: "Reminder engine",
        meta: {
          kind: r.kind,
          reminderTitle: r.title,
          dueAt: r.dueAt.toISOString(),
          reminderId: r.id,
        },
        dedupeKey: `esc:${r.id}`,
      }).catch(() => undefined);
    }
    escalated++;
  }

  // 9. invoice dunning: past-due SENT flips to OVERDUE.
  // Contained: dunning never fails the reminder sweep.
  try {
    const dunning = await sweepDunning();
    flipped += dunning.overdue;
  } catch (err) {
    console.error("[reminders] dunning sweep failed", err);
  }

  // 10. ADR-006 renewal track: fire confirmed obligations inside their radar
  // window (RM task refresh + client reminder + timeline event, all
  // idempotent). Dynamic import: the adapter statically imports this module.
  // Contained: renewals never fail the reminder sweep.
  try {
    const { getRenewalPorts } = await import("@/lib/adapters/renewals");
    const { sweepRenewals } = await import("@/lib/services/renewal-track");
    const renewals = await sweepRenewals(getRenewalPorts(), now);
    fired += renewals.fired;
  } catch (err) {
    console.error("[reminders] renewal sweep failed", err);
  }
  return { fired, created, escalated, flipped };
}

// ───────────────── HMR-safe singleton sweeper ─────────────────

type SweepState = {
  timer: NodeJS.Timeout | null;
  lastResult: {
    at: string;
    fired: number;
    created: number;
    escalated: number;
    flipped: number;
  } | null;
  running: boolean;
};
const g = globalThis as unknown as { __clReminderSweep?: SweepState };
const state: SweepState = (g.__clReminderSweep ??= {
  timer: null,
  lastResult: null,
  running: false,
});

export function lastSweep(): SweepState["lastResult"] {
  return state.lastResult;
}

/** Manual/triggered sweep used by the API route. */
export async function runSweep(): Promise<ReturnType<typeof sweepReminders>> {
  if (state.running)
    return lastSweep() ?? { fired: 0, created: 0, escalated: 0, flipped: 0 };
  state.running = true;
  try {
    const result = await sweepReminders();
    state.lastResult = { at: new Date().toISOString(), ...result };
    return result;
  } finally {
    state.running = false;
  }
}

/** Start the interval sweeper (no-op when already running; survives HMR). */
export function ensureReminderSweeper(): void {
  if (state.timer) return;
  // P0-2 runner decision: on a serverless host timers freeze between
  // invocations and scale to zero — /api/cron/tick owns the cadence there.
  // The in-process sweeper runs only off serverless (self-hosted / dev).
  if (isServerless()) {
    console.info(
      "[reminders] in-process sweeper disabled on serverless (cron tick owns cadence)"
    );
    return;
  }
  state.timer = setInterval(() => {
    const overlap = noteSweeperRun("in-process");
    if (overlap) {
      console.warn(
        `[automation] sweep overlap: ${
          overlap.driver
        } driver swept recently — duplicate work, idempotent (count=${sweepOverlapCountSinceBoot()})`
      );
    }
    void runSweep().catch(() => undefined);
  }, 5 * 60_000);
  if (typeof state.timer === "object" && "unref" in state.timer)
    state.timer.unref();
  void runSweep().catch(() => undefined); // catch-up sweep on boot
}
