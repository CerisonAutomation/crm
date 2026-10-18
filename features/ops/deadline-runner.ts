/**
 * Deadline workflow runner — arms a programme's statutory deadlines when a case
 * reaches the state that starts their clock.
 *
 * Design note (why this is not a new table): the platform already has a durable
 * deadline ledger — `Reminder` — with a UNIQUE `dedupeKey`, a `dueAt`, a status
 * ladder (SCHEDULED → FIRED → ESCALATED) and a sweeper (`sweepReminders` in
 * `src/lib/services/reminders.ts`) that fires due rows and emits `reminder.due`.
 * A deadline window is therefore armed by writing ONE `Reminder` keyed
 * `deadline:<caseId>:<windowKey>`; the row IS the durable wake, so a restart
 * between arming and firing loses nothing. Re-entering the same state — a retry,
 * a replay, a double-click — arms the window exactly once (R3 idempotency).
 *
 * The windows themselves live on `ProgramVersion.deadlineWindows`, so a
 * catalogue change never retroactively re-times an in-flight file.
 */
import { addDays } from "date-fns";
import { appendEvent } from "@/lib/services/case-ledger";
import { prismaDeadlineCaseSource } from "@/lib/adapters/deadline-cases";
import type { DeadlineCaseSource } from "@/lib/ports/deadline-cases";
import { audit } from "@/lib/api-helpers";
import { scheduleReminder } from "@/lib/services/reminders";
import { CaseState, type DeadlineAnchor, type DeadlineWindow } from "@/features/cases/types";

/** Which deadline anchor a case-file state starts the clock for (null = none). */
export function anchorOf(state: CaseState): DeadlineAnchor | null {
  switch (state) {
    case CaseState.AUTHORITY_SUBMITTED:
      return "submission";
    case CaseState.APPROVAL_IN_PRINCIPLE:
      return "approval_in_principle";
    default:
      return null;
  }
}

/** The shape `pickActiveVersion` needs — a structural subset of `ProgramVersion`. */
export interface VersionLike {
  version: number;
  status: string;
  effectiveAt: Date | null;
  effectiveTo: Date | null;
}

/**
 * Pick the version in force for a case: the newest PUBLISHED version whose
 * `effectiveAt` has passed and whose `effectiveTo` has not, else the
 * highest-numbered version. Never throws — a programme with no versions simply
 * arms no deadlines.
 */
export function pickActiveVersion<T extends VersionLike>(versions: T[], now: Date = new Date()): T | null {
  if (versions.length === 0) return null;
  const published = versions
    .filter(
      (v) =>
        v.status === "PUBLISHED" &&
        (!v.effectiveAt || v.effectiveAt.getTime() <= now.getTime()) &&
        (!v.effectiveTo || v.effectiveTo.getTime() >= now.getTime()),
    )
    .sort(
      (a, b) =>
        (b.effectiveAt?.getTime() ?? 0) - (a.effectiveAt?.getTime() ?? 0) || b.version - a.version,
    );
  if (published.length > 0) return published[0];
  return [...versions].sort((a, b) => b.version - a.version)[0];
}

/**
 * Narrow an untyped `ProgramVersion.deadlineWindows` JSON value to well-formed
 * windows. Malformed entries are dropped rather than trusted — the column is
 * operator-authored JSON, so it is a system boundary.
 */
export function readDeadlineWindows(raw: unknown): DeadlineWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((w): w is DeadlineWindow => {
    if (!w || typeof w !== "object") return false;
    const c = w as Partial<DeadlineWindow>;
    return (
      typeof c.key === "string" &&
      c.key.length > 0 &&
      (c.daysAfter === "submission" || c.daysAfter === "approval_in_principle") &&
      typeof c.days === "number" &&
      Number.isFinite(c.days) &&
      c.days >= 0
    );
  });
}

export interface SpawnResult {
  /** Window keys armed by THIS call (already-armed windows are not re-counted). */
  armed: string[];
  /** The anchor the state resolved to, or null when the state arms nothing. */
  anchor: DeadlineAnchor | null;
}

/**
 * Arm every deadline window anchored to `newState` for a case.
 *
 * Idempotent per (caseId, windowKey): a second call for the same state arms
 * nothing new and appends no duplicate ledger event. The case read arrives via
 * DeadlineCaseSource (H2 port, Prisma adapter by default) — this module never
 * imports the database directly, so the H4 gate covers it with no exclusion.
 */
export async function spawnDeadlineRuns(
  caseId: string,
  newState: CaseState,
  now: Date = new Date(),
  source: DeadlineCaseSource = prismaDeadlineCaseSource,
): Promise<SpawnResult> {
  const anchor = anchorOf(newState);
  if (!anchor) return { armed: [], anchor: null };

  const kase = await source.loadCaseVersions(caseId);
  if (!kase) return { armed: [], anchor };

  const version = pickActiveVersion(kase.versions, now);
  const windows = readDeadlineWindows(version?.deadlineWindows);

  const armed: string[] = [];
  for (const w of windows) {
    if (w.daysAfter !== anchor) continue;
    const dueAt = addDays(now, w.days);
    const res = await scheduleReminder({
      caseId,
      kind: "CUSTOM",
      title: w.label ?? `Deadline: ${w.key}`,
      detail: `Statutory deadline ${w.days} day(s) after ${anchor.replace(/_/g, " ")}.`,
      dueAt,
      audience: "RM",
      dedupeKey: `deadline:${caseId}:${w.key}`,
      metadata: { windowKey: w.key, anchor, days: w.days },
    });
    if (!res.created) continue; // already armed — idempotent no-op
    armed.push(w.key);
    // R2: the reminder row above is durable (UNIQUE dedupeKey — a retry will
    // not double-arm), so a ledger failure HALTS loudly instead of arming a
    // deadline the chain never recorded.
    try {
      await appendEvent({
        caseId,
        topic: "DEADLINE_ARMED",
        payload: { window: w, runAt: dueAt.toISOString(), anchor },
      });
    } catch (err) {
      console.error("[deadline-runner] ledger append failed — halting", err);
      await audit({
        orgId: kase.orgId,
        action: "ledger.INTEGRITY_ALERT",
        target: caseId,
        actorLabel: "deadline-runner",
        reason: `DEADLINE_ARMED for window ${w.key} could not be hash-chained; arming halted`,
      });
      throw err instanceof Error ? err : new Error("Case ledger append failed");
    }
  }

  return { armed, anchor };
}
