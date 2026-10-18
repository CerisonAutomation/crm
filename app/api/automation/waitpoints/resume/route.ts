import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { getWaitpointByToken, resumeWaitpoint } from "@/lib/automation/waitpoints";
import { resumeRunAfterDecision, resumeRunAfterEventPoint } from "@/lib/services/workflow-engine";

/**
 * POST /api/automation/waitpoints/resume — redeem a waitpoint resume token.
 *
 * The first API consumer for durable waitpoints (Trigger.dev pattern): a
 * paused run persists a resume token + context snapshot, and this route
 * redeems it exactly once — the conditional waitpoint claim plus the
 * exactly-once step claim in the engine mean a duplicate delivery converges
 * instead of double-resuming.
 *
 * APPROVAL waits need an explicit decision (APPROVED/REJECTED, REJECT needs a
 * reason — the four-eyes rule itself is enforced by the approval flow).
 * EVENT/CALLBACK waits merge the delivered payload into the run context and
 * continue from the next node. TIMER waits are never token-resumed (they
 * expire via the reaper). Tenant-scoped end to end: a token from another
 * organisation matches nothing resumable and fails closed.
 */

const ResumeBodySchema = z.object({
  token: z.string().min(1).max(200),
  decision: z.enum(["APPROVED", "REJECTED"]).optional(),
  reason: z.string().max(2000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    // Resuming a paused run continues its side effects — a lifecycle write,
    // never a read. run.approve is desk-held; the read-only AUDITOR and
    // CLIENT roles cannot resume anything.
    requireCapability(ctx, "run.approve");
    const raw = await readJson<unknown>(r);
    const parsed = ResumeBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError(`Invalid request body: ${parsed.error.issues.map((e) => e.message).join(", ")}`, 400);
    }
    const body = parsed.data;

    const wp = await getWaitpointByToken(body.token);
    if (!wp || wp.status !== "WAITING" || wp.expiresAt <= new Date()) {
      throw new DomainError("Waitpoint not found or no longer resumable", 404);
    }
    const run = await db.workflowRun.findUnique({
      where: { id: wp.runId },
      include: { workflow: { select: { orgId: true } } },
    });
    if (!run || run.workflow.orgId !== ctx.orgId) {
      throw new DomainError("Waitpoint not found or no longer resumable", 404);
    }

    const label = actorLabel(ctx);
    if (wp.kind === "APPROVAL") {
      if (!body.decision) throw new DomainError("An APPROVAL wait needs a decision", 400);
      if (body.decision !== "APPROVED" && !(body.reason && body.reason.trim())) {
        throw new DomainError("A reason is mandatory unless APPROVED", 400);
      }
      const redeemed = await resumeWaitpoint(body.token, {
        resumeToken: body.token,
        resumedBy: label,
        payload: body.payload,
      });
      if (!redeemed) throw new DomainError("Wait already resumed", 409);
      await resumeRunAfterDecision(wp.runId, wp.nodeRunId, body.decision, body.reason ?? "", ctx.userId, label, ctx.orgId);
    } else if (wp.kind === "EVENT" || wp.kind === "CALLBACK") {
      const redeemed = await resumeWaitpoint(body.token, {
        resumeToken: body.token,
        resumedBy: label,
        payload: body.payload,
      });
      if (!redeemed) throw new DomainError("Wait already resumed", 409);
      await resumeRunAfterEventPoint({
        runId: wp.runId,
        nodeRunId: wp.nodeRunId,
        payload: body.payload,
        actorLabel: label,
        orgId: ctx.orgId,
      });
    } else {
      throw new DomainError("TIMER waits resume by expiry, not by token", 400);
    }

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: label,
      action: "automation.waitpoint.resumed",
      target: wp.runId,
      after: { kind: wp.kind, decision: body.decision ?? null, nodeRunId: wp.nodeRunId },
      reason: body.reason ?? undefined,
      correlationId,
    });
    return jsonOk({ resumed: true, kind: wp.kind, runId: wp.runId });
  })(req);
}
