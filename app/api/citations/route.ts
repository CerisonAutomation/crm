import { NextRequest } from "next/server";
import { db, withTenantContext, type TenantTx } from "@/lib/db";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createCitation, getCitations } from "@/lib/services/citation";
import { notFound, validationFailed } from "@/lib/api-errors";

// Citations carry no orgId of their own — tenancy is inherited from the AI run
// they belong to, so the run is loaded and checked before any read or write.
async function ownedRun(aiRunId: string, orgId: string, tx: TenantTx) {
  const run = await tx.aiRun.findUnique({ where: { id: aiRunId }, select: { id: true, orgId: true } });
  if (!run || run.orgId !== orgId) throw notFound("AI run not found");
  return run;
}

// GET /api/citations?aiRunId= (required)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const aiRunId = new URL(r.url).searchParams.get("aiRunId");
    if (!aiRunId) throw validationFailed("aiRunId is required");
    // Run lookup inside the tenant transaction; the citation read that follows
    // targets an already-authorized run id (service reads stay app-scoped). 
    await withTenantContext(ctx.orgId, (tx) => ownedRun(aiRunId, ctx.orgId, tx));
    const citations = await getCitations(aiRunId);
    return jsonOk({ citations });
  })(req);
}

// POST /api/citations
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      aiRunId?: string;
      sourceType?: string;
      sourceId?: string;
      sourceLabel?: string;
      quote?: string;
      confidence?: number;
    }>(r);
    if (!body?.aiRunId) throw validationFailed("aiRunId is required");
    if (!body?.sourceType) throw validationFailed("sourceType is required");
    const aiRunId: string = body.aiRunId;
    await withTenantContext(ctx.orgId, (tx) => ownedRun(aiRunId, ctx.orgId, tx));
    const citation = await createCitation({
      aiRunId: body.aiRunId,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      sourceLabel: body.sourceLabel,
      quote: body.quote,
      confidence: body.confidence,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "citation.created",
      target: citation.id,
      after: { aiRunId: citation.aiRunId, sourceType: citation.sourceType },
      correlationId,
    });
    return jsonOk({ citation }, 201);
  })(req);
}
