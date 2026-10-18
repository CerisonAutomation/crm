import { db } from "@/lib/db";
import { programmeByKey } from "@/lib/domain/programmes";
import { evaluateDwell, type DwellParty } from "@/lib/domain/dwell";

/**
 * Triage scoring (CONSOLIDATED 2026-10-06). The citizen-lane /api/triage
 * route imports this module, which never existed upstream — implemented here
 * against the canonical Case schema. P1 = needs human now, P3 = routine.
 *
 * Complexity weighting: a file is not equally demanding across programmes. The
 * programme's own `complexity` (1–5) contributes up to 20 points, so a
 * five-jurisdiction-by-hand citizenship file outranks a short-stay permit at the
 * same age and risk. The weight comes from the catalogue, never from a
 * hardcoded key list.
 */
export type TriageTier = "P1" | "P2" | "P3";

export interface TriageScore {
  caseId: string;
  reference: string;
  tier: TriageTier;
  score: number;
  factors: string[];
  /** Dwell pressure over the current stage's SLA; null while within SLA. */
  dwell: { party: DwellParty; overdueDays: number; cost: number; reason: string } | null;
}

/** Blunt staleness fallback, used only for states with no lifecycle stage. */
const STALE_DAYS = 7;
/** Cap on the dwell contribution so it can never outrank a `risk:HIGH` (50). */
const DWELL_SCORE_CAP = 40;

export async function scoreCase(caseId: string): Promise<TriageScore | null> {
  const c = await db.case.findUnique({
    where: { id: caseId },
    include: {
      requests: { where: { status: "OPEN" }, select: { id: true } },
      followUps: { where: { status: { not: "COMPLETED" } }, select: { id: true, dueDate: true } },
      programme: { select: { key: true } },
      // Oldest-first: `slaForCase` takes the LAST entry matching the current
      // status as the stage-entry time, so this ordering must not be reversed.
      statusHistory: { select: { to: true, command: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 20 },
    },
  });
  if (!c) return null;
  const factors: string[] = [];
  let score = 0;
  // Programme complexity — the catalogue decides, not a hardcoded list.
  const complexity = c.programme ? programmeByKey(c.programme.key)?.complexity : undefined;
  if (complexity !== null && complexity !== undefined) {
    score += complexity * 4;
    factors.push(`programme complexity ${complexity}/5`);
  }
  if (c.riskFlag === "HIGH") {
    score += 50;
    factors.push("risk:HIGH");
  } else if (c.riskFlag === "LOW") {
    score += 15;
    factors.push("risk:LOW");
  }
  if (c.dataApproval === "REJECTED" || c.serviceApproval === "REJECTED") {
    score += 30;
    factors.push("approval rejected");
  } else if (c.dataApproval === "PENDING" || c.serviceApproval === "PENDING") {
    score += 10;
    factors.push("approval pending");
  }
  if (c.requests.length > 0) {
    score += Math.min(10 + c.requests.length * 2, 20);
    factors.push(`${c.requests.length} open doc requests`);
  }
  const overdue = c.followUps.filter((f) => f.dueDate && f.dueDate < new Date()).length;
  if (overdue > 0) {
    score += 20;
    factors.push(`${overdue} overdue follow-ups`);
  }
  // Dwell — per-stage SLA pressure attributed to whoever the case is actually
  // waiting on. Supersedes the old flat 7-day staleness check on the main path:
  // a stage SLA is the honest threshold, and it knows whose move it is.
  const now = new Date();
  const terminal = ["COMPLETED", "CANCELLED"].includes(c.status);
  const dwell = terminal
    ? null
    : evaluateDwell(
        { status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt, statusHistory: c.statusHistory },
        now,
        { complexity: complexity ?? null, riskFlag: c.riskFlag },
      );
  if (dwell) {
    if (dwell.overdue) {
      score += Math.min(Math.round(dwell.cost), DWELL_SCORE_CAP);
      factors.push(`dwell ${Math.round(dwell.overdueDays)}d overdue (${dwell.party.toLowerCase()})`);
    }
  } else if (!terminal) {
    // No lifecycle stage to measure against — keep the blunt fallback.
    const ageDays = (now.getTime() - c.updatedAt.getTime()) / 86_400_000;
    if (ageDays > STALE_DAYS) {
      score += 15;
      factors.push(`stale ${Math.floor(ageDays)}d in ${c.status}`);
    }
  }
  const tier: TriageTier = score >= 50 ? "P1" : score >= 25 ? "P2" : "P3";
  return {
    caseId: c.id,
    reference: c.reference,
    tier,
    score,
    factors,
    dwell: dwell
      ? {
          party: dwell.party,
          overdueDays: Math.round(dwell.overdueDays * 10) / 10,
          cost: Math.round(dwell.cost * 10) / 10,
          reason: dwell.reason,
        }
      : null,
  };
}

/**
 * Rescore the active-case queue for ONE organisation. `orgId` is mandatory:
 * triage data is tenant-scoped, and an optional scope previously allowed a
 * caller that omitted the argument to read every organisation's cases.
 */
export async function recalculateTriage(orgId: string): Promise<TriageScore[]> {
  const cases = await db.case.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] }, orgId },
    select: { id: true },
    take: 500,
  });
  const out: TriageScore[] = [];
  for (const c of cases) {
    const s = await scoreCase(c.id);
    if (s) out.push(s);
  }
  const rank: Record<TriageTier, number> = { P1: 0, P2: 1, P3: 2 };
  return out.sort((a, b) => rank[a.tier] - rank[b.tier] || b.score - a.score);
}
