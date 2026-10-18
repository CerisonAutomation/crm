import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
// NOTE: status mapping uses DomainError only — see the review route: the
// ApiRequestError helpers fall through to 500 at runtime (framework gap).
import { getDuplicateCandidateRoot, executePartyMergeRoot } from "@/lib/duplicate-merge/composition";

export const dynamic = "force-dynamic";

// POST /api/parties/duplicates/[id]/merge — execute a CONFIRMED merge.
// Body: { survivorId, absorbedId, reason }. The confirmer is read from the
// STORED candidate row (reviewedBy) and passed as reportedBy, so the executor
// must be a different human than the confirmer — genuine two-person control
// with no migration and nothing trusted from the client. A reason is mandatory.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "party.merge");
    const { id } = await params;
    const body = await readJson<{ survivorId?: string; absorbedId?: string; reason?: string }>(r);
    if (!body?.survivorId || !body?.absorbedId) {
      throw new DomainError("survivorId and absorbedId are required", 400);
    }
    if (!body?.reason || body.reason.trim().length === 0) {
      throw new DomainError("a reason note is required to merge", 400);
    }
    const stored = await getDuplicateCandidateRoot(id);
    if (!stored || stored.orgId !== ctx.orgId) throw new DomainError("Duplicate candidate not found", 404);
    const res = await executePartyMergeRoot({
      candidateId: id,
      orgId: ctx.orgId,
      survivorId: body.survivorId,
      absorbedId: body.absorbedId,
      executorId: ctx.userId,
      executorLabel: actorLabel(ctx),
      reportedBy: stored.reviewedBy ?? "system",
      reason: body.reason,
      correlationId,
    });
    if (!res.ok) {
      if (res.error.indexOf("another organisation") >= 0 || res.error.indexOf("not found") >= 0 || res.error.indexOf("pair not found") >= 0) throw new DomainError(res.error, 404);
      if (res.error.indexOf("four-eyes") >= 0) throw new DomainError(res.error, 403);
      throw new DomainError(res.error, 400);
    }
    return jsonOk({ ledgerId: res.ledgerId, receipt: res.receipt, deduped: res.deduped }, res.deduped ? 200 : 201);
  })(req);
}
