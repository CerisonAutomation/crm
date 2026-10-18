/**
 * Renewal-track adapters at the edge (ADR-004/006 strangler slice).
 *
 * Prisma-backed RenewalStorePort + effect-backed RenewalSinkPort, and the
 * single composition root (getRenewalPorts) routes/cron use. Everything
 * durable reuses existing infra: the automation queue (retry + DLQ), the
 * Reminder ledger + 5-minute deadline sweep, CrmTask for the RM chase, the
 * case event hub + notify matrix for client reminders, the CRM activity
 * timeline for the record. No new scheduler, no new tables.
 */
import { db } from "@/lib/db";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { recordActivity } from "@/lib/services/crm";
import { scheduleReminder } from "@/lib/services/reminders";
import { createTask } from "@/lib/services/crm";
import { enqueueAutomationJob } from "@/lib/automation/queue";
import { toRenewalActivity } from "@/lib/domain/renewals";
import type {
  RenewalPorts,
  RenewalRecord,
  RenewalSinkPort,
  RenewalStorePort,
} from "@/lib/ports/renewals";

const toRecord = (row: {
  id: string;
  orgId: string;
  caseId: string | null;
  clientId: string;
  kind: string;
  title: string;
  notes: string | null;
  dueAt: Date;
  remindAt: Date | null;
  status: string;
}): RenewalRecord => ({ ...row });

/** Prisma adapter for the obligation ledger (existing RenewalReminder table). */
const prismaRenewalStore: RenewalStorePort = {
  create: async (input) => {
    const row = await db.renewalReminder.create({
      data: {
        orgId: input.orgId,
        caseId: input.caseId,
        clientId: input.clientId,
        kind: input.kind,
        title: input.title,
        notes: input.notes,
        dueAt: input.dueAt,
        remindAt: input.remindAt,
        status: input.status,
      },
    });
    return toRecord(row);
  },
  findById: async (id) => {
    const row = await db.renewalReminder
      .findUnique({ where: { id } })
      .catch(() => null);
    return row ? toRecord(row) : null;
  },
  listFirable: async (now) => {
    const rows = await db.renewalReminder
      .findMany({
        where: {
          status: "OPEN",
          OR: [{ remindAt: null }, { remindAt: { lte: now } }],
        },
        orderBy: { dueAt: "asc" },
        take: 200,
      })
      .catch(() => []);
    return rows.map(toRecord);
  },
  listForClient: async (clientId) => {
    const rows = await db.renewalReminder
      .findMany({ where: { clientId }, orderBy: { dueAt: "asc" }, take: 200 })
      .catch(() => []);
    return rows.map(toRecord);
  },
  setStatus: async (id, status) => {
    const row = await db.renewalReminder
      .update({ where: { id }, data: { status } })
      .catch(() => null);
    return row ? toRecord(row) : null;
  },
};

/** Effect adapter: queue + reminder ledger + RM task + hub + timeline. */
const renewalSink: RenewalSinkPort = {
  enqueueReminderJob: async ({ renewal, delayMs, dedupeKey }) => {
    await enqueueAutomationJob({
      topic: "reminder.due",
      payload: {
        event: "reminder.due",
        occurredAt: new Date().toISOString(),
        caseId: renewal.caseId ?? undefined,
        data: {
          kind: "RENEWAL",
          renewalId: renewal.id,
          renewalKind: renewal.kind,
          title: renewal.title,
          dueAt: renewal.dueAt.toISOString(),
        },
      },
      orgId: renewal.orgId,
      correlationId: dedupeKey,
      dedupeKey,
      delayMs,
    });
  },
  scheduleClientReminder: async ({ renewal, dedupeKey, dueAt }) => {
    await scheduleReminder({
      caseId: renewal.caseId,
      clientId: renewal.clientId,
      kind: "COMPLIANCE",
      title: renewal.title,
      detail:
        "Renewal / aftercare obligation - due " +
        dueAt.toISOString().slice(0, 10),
      dueAt: renewal.remindAt ?? new Date(),
      audience: "BOTH",
      dedupeKey: "renewal-reminder:" + dedupeKey,
      metadata: { renewalId: renewal.id, renewalKind: renewal.kind },
    });
  },
  ensureRmTask: async ({ renewal, marker }) => {
    const existing = await db.crmTask
      .findFirst({
        where: {
          orgId: renewal.orgId,
          status: "OPEN",
          notes: { contains: marker },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (existing) return;
    const due = renewal.dueAt.toISOString().slice(0, 10);
    await createTask(renewal.orgId, "renewal-track", {
      title: "Renewal chase: " + renewal.title + " (due " + due + ")",
      notes: marker + " renewalId=" + renewal.id,
      caseId: renewal.caseId,
      priority: "MEDIUM",
      dueDate: renewal.dueAt.toISOString(),
    }).catch(() => undefined);
  },
  emitRenewalEvent: async ({ renewal, topic, actorLabel, dedupeKey }) => {
    const activity = toRenewalActivity(renewal);
    if (renewal.caseId) {
      const hubTopic =
        topic === "reminder.due" ? "reminder.due" : "reminder.created";
      await emitCaseEvent(hubTopic as "reminder.due", {
        caseId: renewal.caseId,
        actorLabel,
        meta: {
          kind: "RENEWAL",
          renewalId: renewal.id,
          renewalKind: renewal.kind,
          reminderTitle: renewal.title,
          dueAt: renewal.dueAt.toISOString(),
        },
        dedupeKey,
      }).catch(() => undefined);
    }
    await recordActivity({
      orgId: renewal.orgId,
      kind: "TASK",
      summary: activity.summary.slice(0, 500),
      caseId: renewal.caseId,
      actorLabel,
      source: "WORKFLOW",
      correlationId: activity.correlationId,
    });
  },
};

/** Composition root: the one place production ports are assembled. */
export function getRenewalPorts(): RenewalPorts {
  return { store: prismaRenewalStore, sink: renewalSink };
}
