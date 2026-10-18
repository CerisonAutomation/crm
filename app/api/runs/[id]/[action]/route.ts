import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { resumeRunAfterDecision } from "@/lib/services/workflow-engine";
import { DomainError } from "@/lib/domain/states";

// POST /api/runs/[id]/retry | /cancel | /approve
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await r.json().catch(() => ({}));

    if (action === "approve") {
      requireCapability(ctx, "run.approve");
      const decision = body.decision as "APPROVED" | "REJECTED";
      if (!["APPROVED", "REJECTED"].includes(decision)) throw new DomainError("decision must be APPROVED or REJECTED", 400);
      if (!body.reason?.trim()) throw new DomainError("Decision reason is mandatory (auditable)", 400);
      // The engine verifies the run's workflow belongs to ctx.orgId (403 otherwise).
      await resumeRunAfterDecision(id, body.nodeRunId, decision, body.reason, ctx.userId, `${ctx.name} [${ctx.role}]`, ctx.orgId);
      return jsonOk({ ok: true });
    }

    if (action === "retry") {
      // Retry STARTS a new run (node side effects), so it is a write. Gating on
      // run.read let the read-only AUDITOR trigger outbound effects.
      requireCapability(ctx, "run.manage");
      const run = await db.workflowRun.findUnique({
        where: { id },
        include: { nodeRuns: { orderBy: { startedAt: "desc" } }, workflow: { select: { orgId: true } } },
      });
      if (!run) throw new DomainError("Run not found", 404);
      if (run.workflow.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      if (run.status !== "FAILED") throw new DomainError("Only failed runs can be retried", 409);
      const failedNode = run.nodeRuns.find((n) => n.status === "FAILED");
      const { startRun } = await import("@/lib/services/workflow-engine");
      // replay = new run against same version (deterministic nodes are idempotent by key)
      const newRun = await startRun({
        workflowId: run.workflowId,
        caseId: run.caseId ?? undefined,
        pageSubmissionId: run.pageSubmissionId ?? undefined,
        trigger: run.trigger,
        context: JSON.parse(run.context || "{}"),
      });
      await db.workflowRun.update({ where: { id }, data: { status: "CANCELLED", error: "Superseded by retry", finishedAt: new Date() } });
      await audit({ orgId: run.workflow.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.run.retried", target: id, after: { newRunId: newRun.id, retriedFrom: failedNode?.nodeKey ?? null } });
      return jsonOk({ runId: newRun.id, retriedFrom: failedNode?.nodeKey ?? null });
    }

    if (action === "cancel") {
      requireCapability(ctx, "run.manage");
      const run = await db.workflowRun.findUnique({ where: { id }, include: { workflow: { select: { orgId: true } } } });
      if (!run) throw new DomainError("Run not found", 404);
      if (run.workflow.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      if (!["RUNNING", "WAITING_APPROVAL", "FAILED"].includes(run.status)) throw new DomainError("Run cannot be cancelled", 409);
      await db.workflowRun.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date(), error: body.reason ?? "Cancelled by operator" } });
      await audit({ orgId: run.workflow.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.run.cancelled", target: id, reason: body.reason ?? undefined });
      return jsonOk({ ok: true });
    }

    throw new DomainError("Unknown run action", 404);
  })(req);
}
