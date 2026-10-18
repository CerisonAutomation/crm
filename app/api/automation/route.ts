import { NextRequest } from "next/server";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import {
  automationHealth,
  recentAutomationEvents,
  emitAutomationEvent,
} from "@/lib/adapters/automation";
import { DomainError } from "@/lib/domain/states";
import { automationQueueStats, listDeadJobs, requeueAutomationJob } from "@/lib/automation/queue";
import { getActiveAlerts, acknowledgeAlert, getAlertHistory } from "@/lib/automation/alerts";

// GET /api/automation — in-app engine activity (ops view)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write"); // SENIOR_RM / ADMIN only
    const [health, recent, queue, dead, alerts] = await Promise.all([
      automationHealth(),
      recentAutomationEvents(12),
      automationQueueStats(),
      listDeadJobs(50),
      getActiveAlerts(),
    ]);
    return jsonOk({
      // The in-app engine is the only automation path.
      engine: { mode: "in-app" },
      // Durable queue + dispatch governor state (capacity, pause, DLQ by severity).
      queue,
      // The dead-letter queue itself — inspectable rows an operator can replay.
      dead,
      health,
      recent,
      viewer: ctx.role,
      alerts,
    });
  })(req);
}

// POST /api/automation — replay a DLQ job, or replay a test event (ops tooling)
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = (await r.json().catch(() => ({}))) as { action?: string; id?: string; topic?: string; note?: string };

    // Operator replay of a dead-lettered job — returns it to the queue with a
    // fresh attempt budget. Only a job currently in the DLQ can be requeued.
    if (body.action === "requeue") {
      if (!body.id) throw new DomainError("A job id is required to requeue", 400);
      const ok = await requeueAutomationJob(body.id);
      if (!ok) throw new DomainError("No dead-lettered job with that id", 404);
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "automation.requeue",
        target: body.id,
        correlationId,
      });
      const [queue, dead] = await Promise.all([automationQueueStats(), listDeadJobs(50)]);
      return jsonOk({ ok: true, queue, dead });
    }

    if (body.topic && body.topic !== "ping") throw new DomainError("Only the ping probe is exposed", 400);
    const result = await emitAutomationEvent(
      "workflow.run.started",
      { probe: true, note: body.note ?? "Manual ping from ops console", source: "admin-console" },
      { actor: `${ctx.name} [${ctx.role}]`, correlationId, orgId: ctx.orgId }
    );
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "automation.ping",
      target: "automation/engine",
      after: result,
      correlationId,
    });
    const [health, recent] = await Promise.all([automationHealth(), recentAutomationEvents(12)]);
    return jsonOk({ result, health, recent }, result.delivered ? 200 : 202);
  })(req);
}

// POST /api/automation/alerts — acknowledge an alert
export async function POST_ALERTS(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = (await r.json().catch(() => ({}))) as { action?: string; alertId?: string };

    if (body.action === "acknowledge") {
      if (!body.alertId) throw new DomainError("alertId is required", 400);
      await acknowledgeAlert(body.alertId);
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "automation.alert.acknowledge",
        target: body.alertId,
        correlationId,
      });
      return jsonOk({ ok: true });
    }

    throw new DomainError("Unknown action", 400);
  })(req);
}
