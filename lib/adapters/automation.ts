/**
 * Automation port — IN-APP ONLY.
 *
 * Citizen Lane runs its own automation engine. Every business event is:
 *
 *   1. recorded in the OutboxEvent ledger (durable, replayable, observable);
 *   2. fanned out IN-APP to the platform's own workflow engine
 *      (`startRunsForTrigger` → node executors), scoped to the emitting
 *      organisation so a tenant's event can never start another tenant's run;
 *   3. mirrored to signed outbound webhooks (admin-managed endpoints).
 *
 * The platform is fully self-contained: no external automation backend, no
 * API keys, no external dependencies.
 *
 * Delivery failure never throws into the business request path. The webhook
 * fan-out is fire-and-forget.
 */
import { db } from "@/lib/db";
import { dispatchWebhook } from "@/lib/integrations/webhooks";
import type { Prisma } from "@/generated/prisma/client";
import {
  canFanOutInApp,
  triggerPieceKeyFor,
  describeFanOut,
  type InAppFanOut,
} from "@/lib/automation/engine";
// Safe at module level: `queue.ts` only reaches this module through the
// type-only import plus a dynamic import inside the dispatch cycle, so there is
// no runtime cycle.
import { enqueueAutomationJob } from "@/lib/automation/queue";

/**
 * Every platform topic, in listing order — the single source of truth for the
 * `AutomationTopic` union and for validation surfaces (MCP dispatch_event,
 * webhook subscriptions).
 */
export const AUTOMATION_TOPICS = [
  "case.created",
  "case.assigned",
  "case.status.changed",
  "case.data.approved",
  "case.data.rejected",
  "case.service.selected",
  "case.service.approved",
  "case.service.rejected",
  "document.uploaded",
  "document.confirmed",
  "document.approved",
  "document.rejected",
  "document.changes_requested",
  "request.created",
  "message.received",
  "ocr.completed",
  "ocr.needs_review",
  "approval.letter.uploaded",
  "dispatch.created",
  "workflow.run.started",
  "workflow.run.completed",
  "page.submitted",
  "selfbuild.completed",
  "workflow.mirrored",
  "reminder.created",
  "reminder.due",
  "reminder.escalated",
  "document.expiring",
  "case.stale",
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "kyc.screened",
  "sof.submitted",
  "prescan.completed",
  "triage.changed",
] as const;

/** Every platform topic, derived from the list above so the two cannot drift. */
export type AutomationTopic = (typeof AUTOMATION_TOPICS)[number];

export type AutomationPayload = {
  event: AutomationTopic;
  occurredAt: string;
  correlationId?: string;
  caseId?: string;
  actor?: string;
  data: Record<string, unknown>;
};

export type DeliveryResult = {
  /** Accepted by the in-app engine (the primary, always-on path). */
  delivered: boolean;
  detail: string;
  status: "PROCESSED" | "DEAD_LETTER";
  /** In-app fan-out outcome. */
  inApp: { started: number; skipped: boolean; detail: string };
};

/**
 * Best-effort write to the outbox ledger: records a delivery outcome, and a
 * failed write is swallowed because it must never fail the business request.
 */
async function annotateLedger(
  id: string,
  data: Prisma.OutboxEventUpdateInput
): Promise<void> {
  await db.outboxEvent.update({ where: { id }, data }).catch(() => undefined);
}

// ───────────────────────── in-app engine (primary) ─────────────────────────

/**
 * Fan an event out to the platform's own workflow engine.
 *
 * Uses a dynamic import: `workflow-engine` imports `emitAutomationEvent` from
 * this module, so a static import here would be a cycle. An organisation is
 * required — an event with no known org is NOT fanned out (fail closed) because
 * the trigger lookup is org-scoped and an unscoped lookup would reach every
 * tenant's published workflows.
 */
async function fanOutInApp(
  topic: AutomationTopic,
  payload: AutomationPayload,
  opts: { orgId?: string; mirrored?: boolean }
): Promise<InAppFanOut> {
  const pieceKey = triggerPieceKeyFor(topic);
  if (!canFanOutInApp(topic, opts.orgId, { mirrored: opts.mirrored })) {
    return { topic, pieceKey, skipped: true, started: [] };
  }
  try {
    const { startRunsForTrigger } = await import(
      "@/lib/services/workflow-engine"
    );
    const started = await startRunsForTrigger(pieceKey, {
      trigger: topic,
      caseId: payload.caseId,
      context: {
        event: topic,
        occurredAt: payload.occurredAt,
        ...payload.data,
      },
      actorLabel: payload.actor ?? "Automation",
      correlationId: payload.correlationId,
      orgId: opts.orgId,
    });
    return { topic, pieceKey, skipped: false, started };
  } catch (err) {
    console.error(`[automation] in-app fan-out failed for ${topic}`, err);
    return { topic, pieceKey, skipped: false, started: [] };
  }
}

/**
 * Emit a business event. Always records an OutboxEvent row, always fans the
 * event out to the in-app engine, and never throws into the business request
 * path.
 */
export async function emitAutomationEvent(
  topic: AutomationTopic,
  data: Record<string, unknown>,
  opts?: {
    caseId?: string;
    actor?: string;
    correlationId?: string;
    orgId?: string;
    defer?: boolean;
    mirrored?: boolean;
  }
): Promise<DeliveryResult> {
  const payload: AutomationPayload = {
    event: topic,
    occurredAt: new Date().toISOString(),
    correlationId: opts?.correlationId,
    caseId: opts?.caseId,
    actor: opts?.actor,
    data,
  };

  // 1. Ledger — the durable record every later step annotates.
  const row = await db.outboxEvent
    .create({
      data: {
        topic: `automation.${topic}`,
        payload: JSON.stringify(payload),
        status: "PENDING",
        correlationId: opts?.correlationId,
      },
    })
    .catch(() => null);

  // 2. DURABLE PATH (opt-in) — hand the event to the queue so it survives a
  //    restart and gets retry-with-backoff + DLQ escalation. Chosen by callers
  //    where the emit is genuinely fire-and-forget and durability beats latency
  //    (a burst of page submissions, a retryable outbound call). The default
  //    stays inline/synchronous: automation latency is unchanged for the
  //    interactive paths that expect the fan-out to have happened by the time
  //    the request returns.
  if (opts?.defer) {
    const job = await enqueueAutomationJob({
      topic,
      payload,
      orgId: opts.orgId,
      correlationId: opts.correlationId,
    });
    const detail = job
      ? `queued durably (job ${job.id})`
      : "queue write failed — event ledgered only";
    if (row)
      await annotateLedger(row.id, {
        status: "PROCESSED",
        attempts: { increment: 1 },
        processedAt: new Date(),
        payload: JSON.stringify({ ...payload, delivery: detail }),
      });
    void dispatchWebhook(topic, payload, opts?.correlationId, opts?.orgId);
    return {
      delivered: Boolean(job),
      detail,
      status: job ? "PROCESSED" : "DEAD_LETTER",
      inApp: { started: 0, skipped: true, detail },
    };
  }

  // 3. IN-APP ENGINE — the primary automation path, always on.
  // `mirrored` marks hub-mirror emissions (runs already started by the hub).
  const inApp = await fanOutInApp(topic, payload, {
    orgId: opts?.orgId,
    mirrored: opts?.mirrored,
  });
  const inAppDetail = describeFanOut(inApp);

  // 4. External sinks — fire-and-forget so neither can slow the mutation.
  void dispatchWebhook(topic, payload, opts?.correlationId, opts?.orgId);

  if (row) {
    await annotateLedger(row.id, {
      status: "PROCESSED",
      attempts: { increment: 1 },
      processedAt: new Date(),
      payload: JSON.stringify({ ...payload, delivery: inAppDetail, inApp }),
    });
  }

  return {
    delivered: true,
    detail: inAppDetail,
    status: "PROCESSED",
    inApp: {
      started: inApp.started.length,
      skipped: inApp.skipped,
      detail: inAppDetail,
    },
  };
}

/** Recent automation deliveries from the outbox ledger. */
export async function recentAutomationEvents(limit = 12) {
  const rows = await db.outboxEvent.findMany({
    where: { topic: { startsWith: "automation." } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    return {
      id: r.id,
      topic: r.topic.replace(/^automation\./, ""),
      status: r.status,
      attempts: r.attempts,
      correlationId: r.correlationId,
      createdAt: r.createdAt.toISOString(),
      detail: (data.delivery as string) ?? null,
      caseId: (data.caseId as string) ?? null,
    };
  });
}

/** Health status of the in-app automation engine. */
export async function automationHealth(): Promise<{
  online: boolean;
  detail: string;
  pendingJobs: number;
  recentDeliveries: number;
}> {
  const pendingJobs = await db.automationJob
    .count({ where: { status: "QUEUED" } })
    .catch(() => 0);
  const recentDeliveries = await db.outboxEvent
    .count({
      where: {
        topic: { startsWith: "automation." },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    .catch(() => 0);
  return {
    online: true,
    detail: "in-app automation engine active",
    pendingJobs,
    recentDeliveries,
  };
}
