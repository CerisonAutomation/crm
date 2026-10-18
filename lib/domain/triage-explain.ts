/**
 * Triage why-P1 drawer - pure domain (Hexagonal, Prisma-free).
 *
 * Read-only explainer over the triage service: it takes a TriageScore-shaped
 * VALUE (never a case id, never the DB) and returns factor chips, dwell
 * attribution and the threshold legend the drawer renders. All functions are
 * pure and non-mutating - safe to call from any render or test.
 *
 * Thresholds mirror scoreCase (P1 >= 50, P2 >= 25): the legend is derived
 * from these constants, never hardcoded twice in JSX.
 */

import type { DwellParty } from "@/lib/domain/dwell";

export type TriageTier = "P1" | "P2" | "P3";

/** Score cut-offs - MUST match scoreCase in src/lib/services/triage.ts. */
export const TRIAGE_THRESHOLDS = { P1: 50, P2: 25 } as const;

/** Read-only input view: structural copy of TriageScore, no service import. */
export interface TriageExplainInput {
  caseId: string;
  reference: string;
  tier: TriageTier;
  score: number;
  factors: readonly string[];
  dwell: {
    party: DwellParty;
    overdueDays: number;
    cost: number;
    reason: string;
  } | null;
}

export type FactorKind =
  | "risk"
  | "complexity"
  | "approval"
  | "requests"
  | "followups"
  | "dwell"
  | "stale"
  | "other";

export interface FactorChip {
  label: string;
  kind: FactorKind;
}

export interface DwellAttribution {
  party: DwellParty;
  partyLabel: string;
  overdueDays: number;
  cost: number;
  reason: string;
}

export interface ThresholdEntry {
  tier: TriageTier;
  minScore: number;
  label: string;
}

const PARTY_LABELS: Record<DwellParty, string> = {
  CLIENT: "Waiting on the client",
  DESK: "Waiting on the desk",
  AUTHORITY: "Waiting on the authority",
  SYSTEM: "Platform step",
};

/** Threshold legend for the drawer footer - derived from TRIAGE_THRESHOLDS. */
export function thresholdLegend(): ThresholdEntry[] {
  return [
    { tier: "P1", minScore: TRIAGE_THRESHOLDS.P1, label: "Needs human now" },
    { tier: "P2", minScore: TRIAGE_THRESHOLDS.P2, label: "Routine queue" },
    { tier: "P3", minScore: 0, label: "Routine" },
  ];
}

/** Classify one service factor string into a chip kind (pure string match). */
export function classifyFactor(factor: string): FactorKind {
  const f = factor.toLowerCase();
  if (f.includes("risk:")) return "risk";
  if (f.includes("complexity")) return "complexity";
  if (f.includes("approval") || f.includes("reject") || f.includes("pending"))
    return "approval";
  if (f.includes("doc request")) return "requests";
  if (
    f.includes("follow-up") ||
    f.includes("followup") ||
    f.includes("follow up")
  )
    return "followups";
  if (f.includes("dwell")) return "dwell";
  if (f.includes("stale")) return "stale";
  return "other";
}

/** Factor chips for the drawer - input array is never mutated. */
export function factorChips(factors: readonly string[]): FactorChip[] {
  return factors.map((label) => ({ label, kind: classifyFactor(label) }));
}

/** Dwell attribution for the drawer - null while the case is within SLA. */
export function dwellAttribution(
  input: TriageExplainInput
): DwellAttribution | null {
  if (!input.dwell) return null;
  const d = input.dwell;
  return {
    party: d.party,
    partyLabel: PARTY_LABELS[d.party] ?? d.party,
    overdueDays: d.overdueDays,
    cost: d.cost,
    reason: d.reason,
  };
}

export interface WhyP1 {
  isP1: boolean;
  tier: TriageTier;
  score: number;
  /** Cut-off the case beat (P1) or is heading for. */
  threshold: number;
  /** score minus P1 cut-off (negative when not P1). */
  pointsAboveP1: number;
  factorChips: FactorChip[];
  dwell: DwellAttribution | null;
  legend: ThresholdEntry[];
}

/**
 * Full drawer model. Read-only: builds a fresh object, never touches the DB,
 * never mutates the input.
 */
export function explainP1(input: TriageExplainInput): WhyP1 {
  return {
    isP1: input.tier === "P1",
    tier: input.tier,
    score: input.score,
    threshold: TRIAGE_THRESHOLDS.P1,
    pointsAboveP1: input.score - TRIAGE_THRESHOLDS.P1,
    factorChips: factorChips(input.factors),
    dwell: dwellAttribution(input),
    legend: thresholdLegend(),
  };
}
