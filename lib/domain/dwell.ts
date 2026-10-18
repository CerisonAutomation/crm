/**
 * Dwell clock — a per-party "demurrage" over the existing stage SLA.
 *
 * `slaForCase` (domain/lifecycle.ts) already measures a case against its current
 * stage's SLA and returns `overdue` / `ageDays`. This module adds the two things
 * an ops worklist actually needs, and nothing else:
 *
 *  1. WHOSE move it is (`party`) — derived from the stage's declared `actors`,
 *     so a ranking never blames the desk for time the case spent waiting on the
 *     client or the authority. This is the whole point: one undifferentiated
 *     stale-clock mis-attributes dwell and trains the desk to nag the wrong
 *     party.
 *  2. A weighted dwell COST — overdue days scaled by party, programme complexity
 *     and case risk — an explainable, *relative* pressure figure the triage queue
 *     can rank on. It is not money, and it is not a legal clock.
 *
 * Prisma-free and pure (the clock is injected), so it is unit-testable and safe
 * to call from any render. The SLA canon is never duplicated here — it is read
 * from the one stage table in `lifecycle.ts` via `slaForCase`.
 */
import {
  LIFECYCLE_STAGES,
  slaForCase,
  type SlaCaseInput,
  type SlaEvaluation,
} from "@/lib/domain/lifecycle";

export type DwellParty = "CLIENT" | "DESK" | "AUTHORITY" | "SYSTEM";

/** Human phrasing for a worklist row. */
export const DWELL_PARTY_LABELS: Record<DwellParty, string> = {
  CLIENT: "Waiting on the client",
  DESK: "Waiting on the desk",
  AUTHORITY: "Waiting on the authority",
  SYSTEM: "Platform step",
};

/**
 * Stages whose real blocker is the authority, not the desk, even though staff
 * are listed as the actors (you chase a dispatched file; you do not "do" it).
 */
const AUTHORITY_STAGES: ReadonlySet<string> = new Set(["DISPATCHED", "FOLLOW_UP"]);

const STAFF: ReadonlySet<string> = new Set(["RM", "SENIOR_RM"]);

/**
 * Whose move a stage is, from its declared `actors`.
 *
 * A client-capable stage can always be advanced by the client, so the blocker is
 * the client even when staff may also act (staff upload an ID on the client's
 * behalf — but the client is who is holding it up).
 */
export function partyForStage(stageKey: string): DwellParty {
  if (AUTHORITY_STAGES.has(stageKey)) return "AUTHORITY";
  const stage = LIFECYCLE_STAGES.find((s) => s.key === stageKey);
  if (!stage || stage.actors.length === 0) return "SYSTEM";
  if (stage.actors.includes("CLIENT")) return "CLIENT";
  if (stage.actors.some((a) => STAFF.has(a))) return "DESK";
  return "SYSTEM";
}

/**
 * Relative escalation weight per party. Authority- and client-caused dwell is
 * partly out of the desk's hands, so it still counts but is discounted; a
 * platform step holding a case is a defect, not a workload, so it ranks lowest.
 */
const PARTY_WEIGHT: Record<DwellParty, number> = {
  DESK: 1,
  AUTHORITY: 0.6,
  CLIENT: 0.5,
  SYSTEM: 0.25,
};

export type DwellConfidence =
  /** A status-history entry matched the current status — the entry time is real. */
  | "exact"
  /** No matching history; `updatedAt` stood in for the entry time. */
  | "estimated"
  /** Neither — `createdAt` stood in. Treat with suspicion on migrated cases. */
  | "fallback";

export type DwellEvaluation = SlaEvaluation & {
  party: DwellParty;
  partyLabel: string;
  /** How the stage-entry time was resolved — gates how much to trust `dueAt`. */
  confidence: DwellConfidence;
  /** Days past the stage SLA (0 while within SLA). */
  overdueDays: number;
  /** Relative pressure: overdueDays × partyWeight × complexity × risk. 0 while within SLA. */
  cost: number;
  /** One human line for the worklist ("why is this expensive"). */
  reason: string;
};

export type DwellOptions = {
  /** Programme complexity 1–5 (from the catalogue); raises the cost of any dwell. */
  complexity?: number | null;
  /** Case risk flag ("HIGH" | "LOW" | …). */
  riskFlag?: string | null;
  /** Operator SLA overrides keyed by stage — passed straight through to `slaForCase`. */
  slaOverrides?: Record<string, number> | null;
};

/** 1.00 for trivial programmes rising to 1.60 for the heaviest (complexity 1–5). */
function complexityFactor(complexity?: number | null): number {
  if (typeof complexity !== "number" || !Number.isFinite(complexity)) return 1;
  const clamped = Math.min(5, Math.max(1, complexity));
  return 1 + (clamped - 1) * 0.15;
}

function riskFactor(riskFlag?: string | null): number {
  return riskFlag === "HIGH" ? 1.5 : 1;
}

/**
 * Measure a case's dwell.
 *
 * Composes `slaForCase` (no duplicated SLA canon) and adds party attribution, a
 * confidence flag, and a weighted cost. Returns `null` when the case state maps
 * to no lifecycle stage — the same contract as `slaForCase`.
 */
export function evaluateDwell(
  c: SlaCaseInput,
  now: Date = new Date(),
  opts: DwellOptions = {},
): DwellEvaluation | null {
  const sla = slaForCase(c, now, opts.slaOverrides ?? null);
  if (!sla) return null;

  const party = partyForStage(sla.stageKey);

  // Mirrors `slaForCase`'s own entry-time preference (matching history →
  // updatedAt → createdAt) so the confidence we report always describes the
  // date that function actually used. One line of duplication, deliberately.
  const matched = (c.statusHistory ?? []).some((h) => h.to === c.status);
  const confidence: DwellConfidence = matched ? "exact" : c.updatedAt ? "estimated" : "fallback";

  const overdueDays = Math.max(0, sla.ageDays - sla.slaDays);
  const cost = overdueDays * PARTY_WEIGHT[party] * complexityFactor(opts.complexity) * riskFactor(opts.riskFlag);

  const reason = sla.overdue
    ? `${sla.stageLabel} overdue ${overdueDays.toFixed(1)}d · ${party.toLowerCase()}${
        confidence !== "exact" ? ` · ${confidence} entry date` : ""
      }`
    : `${sla.stageLabel} within SLA (${sla.remainingDays.toFixed(1)}d left)`;

  return {
    ...sla,
    party,
    partyLabel: DWELL_PARTY_LABELS[party],
    confidence,
    overdueDays,
    cost,
    reason,
  };
}
