import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
// NOTE: status mapping uses DomainError only — handler()/jsonError maps just
// DomainError to HTTP codes, while ApiRequestError helpers (notFound,
// validationFailed, forbidden) fall through to 500 at runtime. Framework gap
// flagged to lead; these routes stay correct by construction.
import { reviewDuplicateCandidateRoot } from "@/lib/duplicate-merge/composition";
import type { ReviewDecision } from "@/lib/ports/duplicate-merge";

export const dynamic = "force-dynamic";

// POST /api/parties/duplicates/[id]/review — confirm or dismiss a queued pair.
// The reporter is always the system detection job (no human filing path exists
// on the row), so it is pinned server-side and never read from the request
// body — a client-supplied reporter would void four-eyes. DISMISS needs a
// reason note (R5), enforced in the use-case.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "party.merge");
    const { id } = await params;
    const body = await readJson<{ decision?: string; reason?: string }>(r);
    if (body?.decision !== "CONFIRM" && body?.decision !== "DISMISS") {
      throw new DomainError('decision must be "CONFIRM" or "DISMISS"', 400);
    }
    const res = await reviewDuplicateCandidateRoot({
      candidateId: id,
      orgId: ctx.orgId,
      reviewerId: ctx.userId,
      reviewerLabel: actorLabel(ctx),
      reportedBy: "system",
      decision: body.decision as ReviewDecision,
      reason: body.reason ?? null,
      correlationId,
    });
    if (!res.ok) {
      if (res.error.indexOf("another organisation") >= 0 || res.error.indexOf("not found") >= 0) throw new DomainError(res.error, 404);
      if (res.error.indexOf("four-eyes") >= 0) throw new DomainError(res.error, 403);
      throw new DomainError(res.error, 400);
    }
    return jsonOk({ candidate: res.candidate });
  })(req);
}
