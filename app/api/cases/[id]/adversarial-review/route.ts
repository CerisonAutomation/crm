import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { buildAdversarialReview, computeExpiredDocuments } from "@/lib/services/adversarial-review";

/**
 * GET /api/cases/[id]/adversarial-review — adversarial pre-filing review.
 * Produces a structured "devil's advocate" argument against approval.
 * ADMIN and SENIOR_RM only (the second half of the two-person rule).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write"); // ADMIN/SENIOR_RM gate

    const c = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findUnique({
      where: { id },
      select: {
        id: true,
        programmeId: true,
        programme: { select: { key: true } },
        documents: {
          select: { type: true },
          where: { status: { notIn: ["REJECTED", "DELETED"] } },
        },
        screenings: {
          select: { checkKey: true },
        },
        sof: true,
      },
      }),
    );
    if (!c) throw new DomainError("Case not found", 404);

    if (ctx.orgId && c.programmeId !== ctx.orgId) {
      // Cases don't have orgId directly; they belong to a client who belongs to an org
      const caseWithClient = await db.case.findUnique({
        where: { id },
        select: { client: { select: { orgId: true } } },
      });
      if (!caseWithClient || caseWithClient.client.orgId !== ctx.orgId) {
        throw new DomainError("Forbidden", 403);
      }
    }

    const programme = c.programme;
    if (!programme) throw new DomainError("Case has no programme", 400);

    const collected = c.documents.map((d) => d.type);
    const expired = await computeExpiredDocuments(db, id);
    const screeningDone = c.screenings.map((s) => s.checkKey);
    const sof = c.sof as Record<string, unknown> | null;
    const sofSubmitted = !!sof?.submittedAt;
    const sofHasEvidence = Array.isArray(sof?.evidenceLinks) && (sof.evidenceLinks as unknown[]).length > 0;

    const review = buildAdversarialReview({
      programmeKey: programme.key,
      collectedDocuments: collected,
      expiredDocuments: expired,
      screeningDone,
      sofSubmitted,
      sofHasEvidence,
    });

    return jsonOk({ review });
  })(req);
}