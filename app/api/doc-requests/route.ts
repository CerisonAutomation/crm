import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { emitCaseEvent } from "@/lib/services/event-hub";

export const dynamic = "force-dynamic";

// GET /api/doc-requests?caseId= — staff list (optionally per case).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const caseId = new URL(r.url).searchParams.get("caseId");
    const requests = await db.documentRequest.findMany({
      where: caseId ? { caseId, case: { orgId: ctx.orgId } } : { case: { orgId: ctx.orgId } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { documents: { select: { id: true, status: true } } },
    });
    return jsonOk({ requests });
  })(req);
}

// POST /api/doc-requests — staff creates a document request on a case.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    // Creation is a write — require the write capability, not the read one.
    // (The read capability is held by the read-only AUDITOR and must never authorize a write.)
    requireCapability(ctx, "request.create");
    const body = await readJson<{ caseId?: unknown; docType?: unknown; title?: unknown; instructions?: unknown; dueDate?: unknown; flexible?: unknown }>(r);
    if (typeof body.caseId !== "string" || !body.caseId) throw new DomainError("caseId required", 400);
    const kase = await db.case.findUnique({ where: { id: body.caseId }, select: { id: true, orgId: true, reference: true } });
    if (!kase) throw new DomainError("Case not found", 404);
    if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const created = await db.documentRequest.create({
      data: {
        caseId: body.caseId,
        docType: typeof body.docType === "string" ? body.docType.slice(0, 60) : "OTHER",
        title: typeof body.title === "string" ? body.title.trim().slice(0, 160) : "Document",
        instructions: typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "",
        dueDate: typeof body.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : null,
        createdBy: ctx.name,
        // Was accepted nowhere and silently dropped, so a caller asking for a
        // flexible request got a standard one and could not tell.
        flexible: body.flexible === true,
      },
    });
    // A request raised here must reach the applicant exactly as one raised through
    // the case-action route does. Without this fan-out the request exists in the
    // database but the client is never told, so it is never answered.
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "request.created",
      target: kase.reference,
      after: { requestId: created.id, docType: created.docType },
      correlationId,
    });
    await emitCaseEvent("request.created", {
      caseId: kase.id,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      meta: { requestId: created.id, docType: created.docType, title: created.title, instructions: created.instructions },
      dedupeKey: created.id,
    });
    return jsonOk({ request: created });
  })(req);
}
