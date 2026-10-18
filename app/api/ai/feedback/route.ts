import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

const RATINGS = ["HELPFUL", "NOT_HELPFUL"] as const;
type Rating = (typeof RATINGS)[number];

/** POST /api/ai/feedback — record a human rating of an AI answer. */
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, ctx.role === "CLIENT" ? "ai.feedback.own" : "ai.feedback.all");
    const body = await readJson<{ agent?: string; caseId?: string; threadId?: string; runId?: string; rating?: string; comment?: string }>(r);
    const rating = body.rating as Rating;
    if (!RATINGS.includes(rating)) throw new DomainError("rating must be HELPFUL or NOT_HELPFUL", 400);
    const agent = (body.agent ?? "assistant").slice(0, 40);
    const comment = body.comment?.trim();
    if (comment && comment.length > 500) throw new DomainError("comment must be 500 characters or fewer", 400);
    if (!body.runId) throw new DomainError("runId is required", 400);
    const run = await db.aiRun.findFirst({ where: { id: body.runId, orgId: ctx.orgId, ...(body.caseId ? { caseId: body.caseId } : undefined) }, select: { id: true, caseId: true } });
    if (!run) throw new DomainError("AI run not found", 404);
    if (body.caseId) {
      const own = await db.case.findFirst({
        where: { id: body.caseId, orgId: ctx.orgId, ...(ctx.role === "CLIENT" ? { clientId: ctx.userId } : undefined) },
        select: { id: true },
      });
      if (!own) throw new DomainError("Forbidden", 403);
    }
    await db.aiFeedback.upsert({
      where: { aiRunId_actorId: { aiRunId: run.id, actorId: ctx.userId } },
      update: { rating, comment: comment ?? null },
      create: { aiRunId: run.id, orgId: ctx.orgId, actorId: ctx.userId, rating, comment: comment ?? null },
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "ai.feedback",
      target: `agent/${agent}`,
      after: { rating, caseId: run.caseId ?? body.caseId ?? null, threadId: body.threadId ?? null, runId: run.id },
      reason: comment,
      correlationId,
    });
    return jsonOk({ ok: true, correlationId });
  })(req);
}
