/**
 * Case progress recompute — server-side wrapper around the pure domain scorer.
 *
 * This module imports `@/lib/db` and MUST NOT be imported by client
 * components. Client code should fetch `/api/cases/[id]/progress` instead.
 */
import { db } from "@/lib/db";
import { computeCaseProgress, type CaseProgress } from "@/lib/domain/case-progress";
import { DomainError } from "@/lib/domain/states";

export type { CaseProgress } from "@/lib/domain/case-progress";

/**
 * Recompute the case progress from the current document state and case status.
 * Server-only — queries the database directly.
 */
export async function recomputeCaseProgress(caseId: string): Promise<CaseProgress> {
  const c = await db.case.findUnique({
    where: { id: caseId },
    include: { programme: true, documents: true, dispatches: true, letters: true, followUps: true },
  });
  if (!c) throw new DomainError("Case not found", 404);

  return computeCaseProgress({
    status: c.status,
    programmeKey: c.programme?.key ?? null,
    documents: c.documents,
    dispatches: c.dispatches,
    letters: c.letters,
    followUps: c.followUps,
  });
}

/**
 * Invalidate any cached progress for a case (if a cache layer is added later).
 * Currently a no-op — progress is always computed fresh.
 */
export function invalidateCaseProgressCache(_caseId: string): void {
  // No-op for now — progress is always computed on demand.
  // If a cache is added, delete the key here.
}
