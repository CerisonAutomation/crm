import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { emitCaseEvent } from "@/lib/services/event-hub";

export const dynamic = "force-dynamic";

// POST /api/doc-requests/[id]/not-needed — mark a request as not needed (with mandatory reason).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "request.create");
    const { id } = await params;
    const body = await readJson<{ reason?: unknown }>(r);
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new DomainError("Reason is required", 400);
    }
    const request = await db.documentRequest.findUnique({
      where: { id },
      include: { case: { select: { id: true, orgId: true, reference: true } } },
    });
    if (!request) throw new DomainError("Request not found", 404);
    if (request.case.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    if (request.status === "FULFILLED") throw new DomainError("Cannot mark a fulfilled request as not needed", 409);
    if (request.status === "NOT_NEEDED") throw new DomainError("Request is already marked as not needed", 409);

    const updated = await db.documentRequest.update({
      where: { id },
      data: { status: "NOT_NEEDED" },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "request.not_needed",
      target: request.case.reference,
      after: { requestId: id, reason: body.reason.trim() },
      correlationId,
    });

    await emitCaseEvent("request.not_needed", {
      caseId: request.case.id,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      meta: { requestId: id, reason: body.reason.trim() },
      dedupeKey: `${id}:not_needed`,
    });

    return jsonOk({ request: updated });
  })(req);
}
