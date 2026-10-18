import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { decideAppeal, fileAppeal } from "@/lib/services/decision";

/**
 * POST /api/decisions/[id]/appeal — §24.5 appeal/correction path.
 *   { action: "file", reason } — a case party opens an appeal (new versioned
 *     row; the original is never mutated; reason mandatory; 30d window).
 *   { action: "decide", outcome: "UPHELD"|"OVERTURNED", reason } — a
 *     senior holding decision.resolve closes it; decider must differ from
 *     appellant and from the original maker/checker.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action?: string;
      reason?: string;
      outcome?: string;
    }>(r);
    const decision = await db.decision.findUnique({
      where: { id },
      include: { case: { select: { id: true, clientId: true, orgId: true } } },
    });
    if (!decision || decision.orgId !== ctx.orgId)
      throw new DomainError("Decision not found", 404);

    if (body.action === "file") {
      // Case parties only: the owning client, or staff in the same org.
      if (ctx.role === "CLIENT") {
        if (!decision.case || decision.case.clientId !== ctx.userId)
          throw new DomainError("Forbidden", 403);
      } else if (
        decision.case?.orgId !== ctx.orgId &&
        decision.orgId !== ctx.orgId
      ) {
        throw new DomainError("Forbidden", 403);
      }
      const appeal = await fileAppeal({
        id,
        appellantId: ctx.userId,
        reason: body.reason ?? "",
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "decision.appeal.filed",
        target: `decision/${id}`,
        after: {
          appealId: appeal.id,
          version: (appeal as { version: number }).version,
        },
        reason: body.reason ?? undefined,
        correlationId,
      });
      return jsonOk({ appeal }, 201);
    }

    if (body.action === "decide") {
      requireCapability(ctx, "decision.resolve");
      const outcome = body.outcome;
      if (outcome !== "UPHELD" && outcome !== "OVERTURNED")
        throw new DomainError("Outcome must be UPHELD or OVERTURNED", 400);
      const decided = await decideAppeal({
        id,
        deciderId: ctx.userId,
        outcome,
        reason: body.reason ?? "",
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "decision.appeal.decided",
        target: `decision/${id}`,
        after: { appealId: decided.id, outcome },
        reason: body.reason ?? undefined,
        correlationId,
      });
      return jsonOk({ appeal: decided });
    }

    throw new DomainError("Unknown action — expected file or decide", 400);
  })(req);
}
