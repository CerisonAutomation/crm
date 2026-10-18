/**
 * KYC/AML screening service — the regulated evidence that a compliance review
 * actually happened.
 *
 * A screening result pins the check key, the severity IN FORCE AT THE TIME (the
 * catalogue can evolve), and who attested it. Rows are append-mostly: a new
 * result supersedes the prior row for the same (caseId, checkKey) rather than
 * deleting it, so history is never rewritten.
 *
 * Required checks always exist: `ensureRequired` seeds one UNKNOWN row per
 * mandatory catalogue check, so nothing can be silently skipped.
 */
import { db } from "@/lib/db";
import {
  SCREENING_CHECKS,
  screeningBlocks,
  outstandingScreenings,
  type ScreeningCheck,
} from "@/lib/domain/lifecycle";

export const SCREENING_RESULTS = ["PASS", "FAIL", "REVIEW", "UNKNOWN"] as const;
export type ScreeningResultValue = (typeof SCREENING_RESULTS)[number];

export type ScreeningRow = {
  id: string;
  checkKey: string;
  result: string;
  severity: string;
  note: string | null;
  providerRef: string | null;
  runByLabel: string | null;
  createdAt: Date;
  supersededAt: Date | null;
};

function toRow(r: {
  id: string; checkKey: string; result: string; severity: string;
  note: string | null; providerRef: string | null; runByLabel: string | null;
  createdAt: Date; supersededAt: Date | null;
}): ScreeningRow {
  return r;
}

/** Mandatory checks that can never be skipped for a case. */
export function requiredChecks(): ScreeningCheck[] {
  return SCREENING_CHECKS.filter((c) => c.required);
}

/**
 * Seed one UNKNOWN row per mandatory check — idempotent. A check that never
 * existed in the result set would vanish from the outstanding list; seeding
 * guarantees the desk always sees the full outstanding set.
 */
export async function ensureRequired(caseId: string): Promise<void> {
  const existing = await db.screeningResult.findMany({
    where: { caseId, supersededAt: null },
    select: { checkKey: true },
  });
  const have = new Set(existing.map((r) => r.checkKey));
  const toInsert = requiredChecks()
    .filter((check) => !have.has(check.key))
    .map((check) => ({
      caseId,
      checkKey: check.key,
      result: "UNKNOWN",
      severity: check.severity,
    }));
  if (toInsert.length > 0) {
    await db.screeningResult.createMany({ data: toInsert });
  }
}

/** Current (non-superseded) results for a case, oldest first. */
export async function listScreenings(caseId: string): Promise<ScreeningRow[]> {
  const rows = await db.screeningResult.findMany({
    where: { caseId, supersededAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRow);
}

export type RecordScreeningInput = {
  checkKey: string;
  result: ScreeningResultValue;
  note?: string;
  providerRef?: string;
  runById?: string;
  runByLabel?: string;
};

/**
 * Record a check outcome: supersede the prior current row for the same check
 * (if any) and insert the new one. Severity is pinned from the catalogue at
 * write time so a later catalogue change cannot rewrite this row's meaning.
 */
export async function recordScreening(caseId: string, input: RecordScreeningInput): Promise<ScreeningRow> {
  const check = SCREENING_CHECKS.find((c) => c.key === input.checkKey);
  if (!check) throw new Error(`Unknown screening check "${input.checkKey}"`);
  if (!SCREENING_RESULTS.includes(input.result)) throw new Error(`Bad screening result "${input.result}"`);

  const now = new Date();
  await db.screeningResult.updateMany({
    where: { caseId, checkKey: input.checkKey, supersededAt: null },
    data: { supersededAt: now },
  });
  const created = await db.screeningResult.create({
    data: {
      caseId,
      checkKey: input.checkKey,
      result: input.result,
      severity: check.severity,
      note: input.note?.slice(0, 2000) ?? null,
      providerRef: input.providerRef?.slice(0, 200) ?? null,
      runById: input.runById ?? null,
      runByLabel: input.runByLabel ?? null,
    },
  });
  return toRow(created);
}

/** The case's screening posture, computed with the shared catalogue helpers. */
export async function screeningPosture(caseId: string): Promise<{
  rows: ScreeningRow[];
  blocked: boolean;
  outstanding: ScreeningCheck[];
}> {
  const rows = await listScreenings(caseId);
  const blocked = screeningBlocks(rows.map((r) => ({ key: r.checkKey, result: r.result })));
  const outstanding = outstandingScreenings(rows.map((r) => ({ key: r.checkKey, result: r.result })));
  return { rows, blocked, outstanding };
}
