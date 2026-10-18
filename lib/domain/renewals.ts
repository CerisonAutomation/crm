/**
 * Renewals domain - pure, Prisma-free aftercare obligations (ADR-006).
 *
 * A renewal obligation is a dated commitment per client (passport expiry,
 * permit renewal, eligibility anniversary, filing deadline) that stays on the
 * radar: staff propose dates, the CLIENT confirms them (wrong dates nagging
 * wrongly is the failure mode ADR-006 calls out), and only confirmed
 * obligations fire reminders + RM tasks through the existing deadline
 * cadence. No scheduler infra lives here - cadence is the caller\u2019s job.
 *
 * Status contract (maps 1:1 onto the RenewalReminder status column):
 *   SCHEDULED = proposed by staff, awaiting client confirmation (never fires)
 *   OPEN      = confirmed (by the client, or self-scheduled by them) - fires
 *   DONE / CANCELLED = terminal, never fires
 *
 * Zero framework imports: safe for routes, client components and unit specs.
 */

export const RENEWAL_KINDS = [
  "DOCUMENT_EXPIRY",
  "PERMIT_RENEWAL",
  "ELIGIBILITY_ANNIVERSARY",
  "FILING_DEADLINE",
  "OBLIGATION",
] as const;

export type RenewalKind = (typeof RENEWAL_KINDS)[number];

export const RENEWAL_KIND_LABELS: Record<RenewalKind, string> = {
  DOCUMENT_EXPIRY: "Document expiry",
  PERMIT_RENEWAL: "Permit renewal",
  ELIGIBILITY_ANNIVERSARY: "Eligibility anniversary",
  FILING_DEADLINE: "Filing deadline",
  OBLIGATION: "Obligation",
};

export type RenewalStatus = "OPEN" | "SCHEDULED" | "DONE" | "CANCELLED";

export const TERMINAL_RENEWAL_STATUSES: ReadonlySet<string> = new Set([
  "DONE",
  "CANCELLED",
]);

/** Reminder-ladder lead times (days before dueAt) for confirmed obligations. */
export const RENEWAL_LADDER_DAYS = [60, 30, 7] as const;

export const MAX_REMIND_LEAD_DAYS = 365;
export const DEFAULT_REMIND_LEAD_DAYS = 30;

export interface RenewalLike {
  id: string;
  kind: string;
  title: string;
  status: string;
  dueAt: Date | string;
  remindAt: Date | string | null;
  clientId: string;
  caseId: string | null;
}

export interface ScheduleRenewalInput {
  kind?: string | null;
  title?: string | null;
  dueAt?: string | null;
  /** Lead time in days before dueAt when the obligation goes on radar. */
  remindInDays?: number | null;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Unhappy-first validation for a schedule request. Returns every problem. */
export function validateScheduleRenewal(input: ScheduleRenewalInput, now: Date = new Date()): string[] {
  const errors: string[] = [];
  const title = (input.title ?? "").trim();
  if (!title) errors.push("title required");
  else if (title.length > 160) errors.push("title must be 160 characters or fewer");
  if (input.kind !== undefined && input.kind !== null && input.kind !== "") {
    if (!(RENEWAL_KINDS as readonly string[]).includes(input.kind)) {
      errors.push("unknown kind \u0027" + input.kind + "\u0027 - expected one of " + RENEWAL_KINDS.join(", "));
    }
  }
  if (!input.dueAt) {
    errors.push("dueAt required (ISO date)");
  } else {
    const ms = toMs(input.dueAt);
    if (ms === null) errors.push("dueAt is not a valid date");
    else {
      if (ms < now.getTime() - 24 * 86_400_000) errors.push("dueAt is in the past");
      if (ms > now.getTime() + 10 * 365 * 86_400_000) errors.push("dueAt is implausibly far out (> 10 years)");
    }
  }
  if (input.remindInDays !== undefined && input.remindInDays !== null) {
    if (!Number.isFinite(input.remindInDays) || (input.remindInDays as number) < 0) {
      errors.push("remindInDays must be 0 or greater");
    } else if ((input.remindInDays as number) > MAX_REMIND_LEAD_DAYS) {
      errors.push("remindInDays must be " + MAX_REMIND_LEAD_DAYS + " or fewer");
    }
  }
  return errors;
}

/**
 * Resolve when the obligation goes on radar. Clamps to now when the window
 * already passed so a late-scheduled obligation fires on the next sweep
 * instead of sitting silent with a past remindAt.
 */
export function resolveRemindAt(dueAt: Date, remindInDays?: number | null, now: Date = new Date()): Date {
  const lead = remindInDays === undefined || remindInDays === null
    ? DEFAULT_REMIND_LEAD_DAYS
    : Math.max(0, Math.min(MAX_REMIND_LEAD_DAYS, Math.floor(remindInDays)));
  const at = new Date(dueAt.getTime() - lead * 86_400_000);
  return at.getTime() < now.getTime() ? now : at;
}

/**
 * Initial status for a new obligation. Self-scheduled client items are
 * confirmed by construction; staff-proposed items wait for the client.
 */
export function initialRenewalStatus(scheduledByClient: boolean): RenewalStatus {
  return scheduledByClient ? "OPEN" : "SCHEDULED";
}

/** Whether this actor may confirm the obligation\u2019s date. */
export function canConfirmRenewal(
  obligation: Pick<RenewalLike, "status" | "clientId">,
  actor: { userId: string; staff: boolean },
): boolean {
  if (obligation.status !== "SCHEDULED") return false;
  if (actor.userId === obligation.clientId) return true;
  return actor.staff;
}

/** Confirm flips a proposed date onto the radar. Anything else is rejected. */
export function confirmRenewalTransition(
  obligation: Pick<RenewalLike, "status">,
): { ok: true; to: RenewalStatus } | { ok: false; error: string } {
  if (obligation.status === "OPEN") return { ok: false, error: "already confirmed" };
  if (obligation.status !== "SCHEDULED") {
    return { ok: false, error: "cannot confirm from status \u0027" + obligation.status + "\u0027" };
  }
  return { ok: true, to: "OPEN" };
}

/** Terminal transitions (DONE = filed/renewed, CANCELLED = withdrawn). */
export function terminalRenewalTransition(
  obligation: Pick<RenewalLike, "status">,
  to: "DONE" | "CANCELLED",
): { ok: true; to: RenewalStatus } | { ok: false; error: string } {
  if (TERMINAL_RENEWAL_STATUSES.has(obligation.status)) {
    return { ok: false, error: "already \u0027" + obligation.status + "\u0027" };
  }
  return { ok: true, to };
}

/**
 * Firable = confirmed, inside the radar window, not terminal. Unconfirmed
 * (SCHEDULED) rows NEVER fire - that is the date-quality gate.
 */
export function isRenewalFirable(
  obligation: Pick<RenewalLike, "status" | "remindAt">,
  now: Date = new Date(),
): boolean {
  if (obligation.status !== "OPEN") return false;
  const at = toMs(obligation.remindAt);
  if (at === null) return true;
  return at <= now.getTime();
}

/** Which ladder windows (60/30/7d) are due for a confirmed obligation. */
export function dueLadderWindows(
  obligation: Pick<RenewalLike, "status" | "dueAt">,
  now: Date = new Date(),
): number[] {
  if (obligation.status !== "OPEN") return [];
  const due = toMs(obligation.dueAt);
  if (due === null) return [];
  const daysLeft = Math.ceil((due - now.getTime()) / 86_400_000);
  if (daysLeft < 0) return [];
  return (RENEWAL_LADDER_DAYS as readonly number[]).filter((w) => daysLeft <= w);
}

/** Dedupe keys - the idempotency contract (C9) for every renewal side effect. */
export function renewalDedupeKeys(obligationId: string): {
  job: string;
  task: string;
  ladder: (windowDays: number) => string;
} {
  return {
    job: "renewal:" + obligationId,
    task: "renewal-task:" + obligationId,
    ladder: (windowDays: number) => "renewal:" + obligationId + ":" + String(windowDays),
  };
}

export type RenewalBucket = "overdue" | "dueSoon" | "upcoming" | "idle";

/** RM radar projection: one bucket per obligation for the workload view. */
export function bucketRenewal(
  obligation: Pick<RenewalLike, "status" | "dueAt">,
  now: Date = new Date(),
): RenewalBucket {
  if (obligation.status === "DONE" || obligation.status === "CANCELLED") return "idle";
  const due = toMs(obligation.dueAt);
  if (due === null) return "idle";
  const daysLeft = Math.ceil((due - now.getTime()) / 86_400_000);
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 30) return "dueSoon";
  return "upcoming";
}

/** Counts per bucket for an RM radar strip. */
export function summarizeRenewals(
  obligations: Array<Pick<RenewalLike, "status" | "dueAt">>,
  now: Date = new Date(),
): Record<RenewalBucket, number> {
  const out: Record<RenewalBucket, number> = { overdue: 0, dueSoon: 0, upcoming: 0, idle: 0 };
  for (const o of obligations) out[bucketRenewal(o, now)] += 1;
  return out;
}

/**
 * Timeline projection input for one obligation - the CRM feed shape
 * (CaseActivity-compatible) so renewals render in the case timeline without
 * this module importing the projector.
 */
export function toRenewalActivity(obligation: Pick<RenewalLike, "id" | "kind" | "title" | "status" | "dueAt">): {
  kind: string;
  summary: string;
  source: string;
  correlationId: string;
} {
  const due = toMs(obligation.dueAt);
  const when = due === null ? "date TBC" : new Date(due).toISOString().slice(0, 10);
  const label = (RENEWAL_KIND_LABELS as Record<string, string>)[obligation.kind] ?? obligation.kind;
  return {
    kind: "TASK",
    summary: label + ": " + obligation.title + " - due " + when + " [" + obligation.status + "]",
    source: "WORKFLOW",
    correlationId: "renewal:" + obligation.id,
  };
}
