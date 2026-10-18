/**
 * Renewal-track use cases - pure orchestration over ports (ADR-006).
 *
 * No Prisma, no network, no clock smuggling: every effect goes through
 * RenewalStorePort / RenewalSinkPort, every timestamp through an injected
 * `now`. Unit specs drive these with memoryRenewalStore + recordingRenewalSink
 * (fake-port tests); production wires the Prisma adapter at the composition
 * root (src/lib/adapters/renewals.ts).
 *
 * Cadence note: scheduling enqueues ONE durable automation-queue job per
 * obligation (survives restarts, retry + DLQ) and one Reminder-ledger row per
 * ladder window; the existing 5-minute deadline sweep (runSweep, owned by the
 * cron tick) fires them. No new scheduler infra.
 */
import {
  confirmRenewalTransition,
  initialRenewalStatus,
  isRenewalFirable,
  renewalDedupeKeys,
  resolveRemindAt,
  terminalRenewalTransition,
  toRenewalActivity,
  validateScheduleRenewal,
} from "@/lib/domain/renewals";
import type { RenewalPorts, RenewalRecord } from "@/lib/ports/renewals";

export type RenewalActor = {
  userId: string;
  orgId: string;
  staff: boolean;
  label: string;
};

export type ScheduleRenewalCaseInput = {
  caseId: string | null;
  clientId: string;
  kind?: string | null;
  title?: string | null;
  notes?: string | null;
  dueAt?: string | null;
  remindInDays?: number | null;
};

export type RenewalReceipt =
  | { ok: true; renewal: RenewalRecord }
  | { ok: false; errors: string[] };

/**
 * Schedule an obligation: validate (unhappy-first), persist with the
 * confirm-gated initial status, then fan out queue job + reminder + RM task
 * + timeline event. Sink failures never fail the schedule - the sweep
 * re-fires from the persisted row (best-effort fan-out, durable truth).
 */
export async function scheduleRenewal(
  ports: RenewalPorts,
  actor: RenewalActor,
  input: ScheduleRenewalCaseInput,
  now: Date = new Date(),
): Promise<RenewalReceipt> {
  const errors = validateScheduleRenewal(input, now);
  if (errors.length > 0) return { ok: false, errors };
  const dueAt = new Date(input.dueAt as string);
  const remindAt = resolveRemindAt(dueAt, input.remindInDays, now);
  const scheduledByClient = !actor.staff;
  const renewal = await ports.store.create({
    orgId: actor.orgId,
    caseId: input.caseId,
    clientId: input.clientId,
    kind: (input.kind ?? "PERMIT_RENEWAL") as string,
    title: (input.title as string).trim().slice(0, 160),
    notes: input.notes?.trim().slice(0, 4000) || null,
    dueAt,
    remindAt,
    status: initialRenewalStatus(scheduledByClient),
  });
  const keys = renewalDedupeKeys(renewal.id);
  const delayMs = Math.max(0, remindAt.getTime() - now.getTime());
  // Best-effort fan-out: each sink is independently idempotent (C9), so a
  // partial failure heals on the next sweep from the persisted row.
  await ports.sink.enqueueReminderJob({ renewal, delayMs, dedupeKey: keys.job }).catch(() => undefined);
  await ports.sink.scheduleClientReminder({ renewal, dedupeKey: keys.job, dueAt }).catch(() => undefined);
  await ports.sink.ensureRmTask({ renewal, marker: keys.task }).catch(() => undefined);
  await ports.sink
    .emitRenewalEvent({ renewal, topic: "reminder.created", actorLabel: actor.label, dedupeKey: "scheduled:" + renewal.id })
    .catch(() => undefined);
  return { ok: true, renewal };
}

/** Client (or staff on their behalf) confirms a proposed date onto the radar. */
export async function confirmRenewal(
  ports: RenewalPorts,
  actor: RenewalActor,
  renewalId: string,
): Promise<RenewalReceipt> {
  const current = await ports.store.findById(renewalId);
  if (!current) return { ok: false, errors: ["renewal not found"] };
  if (current.orgId !== actor.orgId) return { ok: false, errors: ["renewal not found"] };
  const isClient = actor.userId === current.clientId;
  if (current.status !== "SCHEDULED") {
    const t = confirmRenewalTransition(current);
    return { ok: false, errors: [t.ok ? "cannot confirm" : t.error] };
  }
  if (!isClient && !actor.staff) return { ok: false, errors: ["only the client or desk staff may confirm"] };
  const updated = await ports.store.setStatus(renewalId, "OPEN");
  if (!updated) return { ok: false, errors: ["renewal not found"] };
  await ports.sink
    .emitRenewalEvent({
      renewal: updated,
      topic: "reminder.created",
      actorLabel: actor.label,
      dedupeKey: "confirmed:" + renewalId,
    })
    .catch(() => undefined);
  return { ok: true, renewal: updated };
}

/** Terminal lifecycle: DONE (filed/renewed) or CANCELLED (withdrawn). */
export async function closeRenewal(
  ports: RenewalPorts,
  actor: RenewalActor,
  renewalId: string,
  to: "DONE" | "CANCELLED",
): Promise<RenewalReceipt> {
  const current = await ports.store.findById(renewalId);
  if (!current) return { ok: false, errors: ["renewal not found"] };
  if (current.orgId !== actor.orgId) return { ok: false, errors: ["renewal not found"] };
  const t = terminalRenewalTransition(current, to);
  if (!t.ok) return { ok: false, errors: [t.error] };
  const updated = await ports.store.setStatus(renewalId, t.to);
  if (!updated) return { ok: false, errors: ["renewal not found"] };
  await ports.sink
    .emitRenewalEvent({
      renewal: updated,
      topic: "reminder.due",
      actorLabel: actor.label,
      dedupeKey: "closed:" + renewalId + ":" + t.to,
    })
    .catch(() => undefined);
  return { ok: true, renewal: updated };
}

export type RenewalSweepResult = { fired: number; tasks: number; reminders: number };

/**
 * Deadline-cadence sweep: fire every confirmed obligation inside its radar
 * window. Unconfirmed (SCHEDULED) and terminal rows are skipped by
 * construction (listFirable + isRenewalFirable double-gate). Each fire
 * refreshes the RM task, the client reminder ladder and the timeline event -
 * all idempotent, so doubled sweeps are harmless.
 */
export async function sweepRenewals(ports: RenewalPorts, now: Date = new Date()): Promise<RenewalSweepResult> {
  const due = await ports.store.listFirable(now).catch(() => [] as RenewalRecord[]);
  const result: RenewalSweepResult = { fired: 0, tasks: 0, reminders: 0 };
  for (const renewal of due) {
    if (!isRenewalFirable(renewal, now)) continue;
    const keys = renewalDedupeKeys(renewal.id);
    const activity = toRenewalActivity(renewal);
    await ports.sink.ensureRmTask({ renewal, marker: keys.task }).catch(() => undefined);
    result.tasks += 1;
    await ports.sink.scheduleClientReminder({ renewal, dedupeKey: keys.job, dueAt: renewal.dueAt }).catch(() => undefined);
    result.reminders += 1;
    await ports.sink
      .emitRenewalEvent({ renewal, topic: "reminder.due", actorLabel: activity.source, dedupeKey: "fired:" + renewal.id })
      .catch(() => undefined);
    result.fired += 1;
  }
  return result;
}
