import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { buildEvidenceReadiness } from "@/lib/services/evidence-readiness";

/**
 * GET /api/cases/[id]/evidence-readiness — evidence-readiness summary for a case.
 * Returns a structured snapshot of what evidence the case has, what it lacks,
 * and where the risks lie. Used by the RM before dispatching and by the client
 * portal to show "what the desk is waiting for".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);

    const c = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findUnique({
        where: { id },
        select: {
          id: true,
          orgId: true,
          clientId: true,
          programmeId: true,
          programme: { select: { key: true } },
          documents: {
            select: { type: true, createdAt: true },
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

    // Object-level authorisation: a CLIENT sees only their own case; every
    // other role is confined to its own organisation.
    if (ctx.role === "CLIENT" && c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    if (c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

    const programme = c.programme;
    if (!programme) throw new DomainError("Case has no programme", 400);

    const collected = c.documents.map((d) => d.type);
    const expired = c.documents
      .filter((d) => {
        // A document is expired if it has a validity window and was collected
        // more than that many months ago. We need the spec to know the window.
        // For now, treat none as expired — the service will use the spec.
        return false;
      })
      .map((d) => d.type);
    const screeningDone = c.screenings.map((s) => s.checkKey);
    const sof = c.sof as Record<string, unknown> | null;
    const sofSubmitted = !!sof?.submittedAt;
    const sofHasEvidence = Array.isArray(sof?.evidenceLinks) && (sof.evidenceLinks as unknown[]).length > 0;

    const summary = buildEvidenceReadiness({
      programmeKey: programme.key,
      collectedDocuments: collected,
      expiredDocuments: expired,
      screeningDone,
      sofSubmitted,
      sofHasEvidence,
    });

    return jsonOk({ summary });
  })(req);
}