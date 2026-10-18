/**
 * CRM service — contacts, tasks and the unified activity timeline.
 *
 * Kept deliberately thin: the value of a CRM layer here is the RELATIONSHIP
 * GRAPH and one append-only timeline, not a second copy of case management. A
 * contact is a person or organisation tracked independently of any case; an
 * activity row is the single place an interaction is recorded, whether it came
 * from an email, a call, a note, a document event or a stage change.
 *
 * `recordActivity` is best-effort and never throws into a business flow — a
 * timeline entry failing must not fail the action it describes.
 *
 * Envelope extension (additive, expand-only): callers may now pass
 * correlationId / source / actorLabel / actorRole / transition / auditEventId.
 * They are folded into the metadata JSON under `_`-prefixed keys, which the
 * pure projector (src/features/rm/crm-projections.ts) reads back into the
 * CaseActivity / CaseTimelineEvent contract — actor, source, timestamp,
 * correlationId, transition — without any schema migration. Old rows without
 * the envelope still project with safe defaults.
 */
import { db } from "@/lib/db";
import {
  caseEventToActivity,
  joinAuditToTimeline,
  projectCaseTimeline,
  toCaseActivity,
} from "@/features/rm/crm-projections";
import type {
  ActivitySource,
  CaseActivity,
  CaseTimelineEvent,
  StateTransition,
} from "@/features/rm/crm-projections";

export type { ActivitySource, CaseActivity, CaseTimelineEvent, StateTransition };
export type { CrmViewDef, CrmViewFilter, RelationLink } from "@/features/rm/crm-projections";

export type ActivityKind = "EMAIL" | "CALL" | "NOTE" | "DOCUMENT" | "STAGE" | "MEETING" | "TASK" | "SYSTEM";

export type RecordActivityInput = {
  orgId: string;
  kind: ActivityKind;
  summary: string;
  contactId?: string | null;
  caseId?: string | null;
  leadId?: string | null;
  actorId?: string | null;
  /** Display name of the actor at write time (roles change; the label is frozen). */
  actorLabel?: string | null;
  /** RM | SENIOR_RM | ADMIN | CLIENT | SYSTEM … — frozen for the projection. */
  actorRole?: string | null;
  /** Where the interaction came from (EMAIL | CALL | IMPORT | …). Defaults to MANUAL. */
  source?: ActivitySource | null;
  /** Joins this row to audit events, ledger rows and fan-out notifications. */
  correlationId?: string | null;
  /** Case/document state change this row records, if any. */
  transition?: StateTransition | null;
  /** Pre-linked audit event id, when the writer already knows it. */
  auditEventId?: string | null;
  metadata?: Record<string, unknown>;
};

function envelope(input: RecordActivityInput): Record<string, unknown> {
  const meta = { ...(input.metadata ?? {}) };
  if (input.source) meta["_source"] = input.source;
  if (input.correlationId) meta["_correlationId"] = input.correlationId;
  if (input.actorLabel) meta["_actorLabel"] = input.actorLabel;
  if (input.actorRole) meta["_actorRole"] = input.actorRole;
  if (input.transition) meta["_transition"] = input.transition;
  if (input.auditEventId) meta["_auditEventId"] = input.auditEventId;
  return meta;
}

/** Append one timeline entry. Best-effort: a failure is swallowed, not raised. */
export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    await db.activity.create({
      data: {
        orgId: input.orgId,
        kind: input.kind,
        summary: input.summary.slice(0, 500),
        contactId: input.contactId ?? null,
        caseId: input.caseId ?? null,
        leadId: input.leadId ?? null,
        actorId: input.actorId ?? null,
        metadata: JSON.stringify(envelope(input)),
      },
    });
  } catch {
    /* timeline is advisory — never break the caller */
  }
}

export type ActivityReceipt = { ok: true; id: string } | { ok: false; id: null };

/**
 * Receipt variant of recordActivity (C11): same best-effort write, but the
 * caller learns whether the row landed and its id for correlation. Still never
 * throws — a failed write resolves `{ ok: false }`, never break the caller.
 */
export async function recordActivityReceipt(input: RecordActivityInput): Promise<ActivityReceipt> {
  try {
    const row = await db.activity.create({
      data: {
        orgId: input.orgId,
        kind: input.kind,
        summary: input.summary.slice(0, 500),
        contactId: input.contactId ?? null,
        caseId: input.caseId ?? null,
        leadId: input.leadId ?? null,
        actorId: input.actorId ?? null,
        metadata: JSON.stringify(envelope(input)),
      },
    });
    return { ok: true, id: row.id };
  } catch {
    /* timeline is advisory — never break the caller */
    return { ok: false, id: null };
  }
}

export type ContactInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  type?: "INDIVIDUAL" | "COMPANY";
  source?: string;
  notes?: string;
  ownerId?: string | null;
};

/** Create a contact and open its timeline with a creation entry. */
export async function createContact(orgId: string, actorId: string, input: ContactInput) {
  const contact = await db.contact.create({
    data: {
      orgId,
      name: input.name.trim().slice(0, 160),
      email: input.email?.trim().toLowerCase().slice(0, 160) || null,
      phone: input.phone?.trim().slice(0, 40) || null,
      company: input.company?.trim().slice(0, 160) || null,
      type: input.type === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
      source: input.source?.trim().toUpperCase().slice(0, 20) || "MANUAL",
      notes: input.notes?.trim().slice(0, 4000) ?? "",
      ownerId: input.ownerId ?? null,
      createdBy: actorId,
    },
  });
  await recordActivity({ orgId, kind: "SYSTEM", summary: `Contact created: ${contact.name}`, contactId: contact.id, actorId, source: "MANUAL" });
  return contact;
}

/** Promote a captured lead into a contact (idempotent by organisation + email). */
export async function contactFromLead(orgId: string, actorId: string, leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) return null;
  const existing = await db.contact.findFirst({ where: { orgId, email: lead.email } });
  if (existing) return existing;
  return createContact(orgId, actorId, {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    source: lead.source === "SITE" ? "LEAD" : lead.source,
    notes: lead.message,
  });
}

export type TaskInput = {
  title: string;
  notes?: string;
  assigneeId?: string | null;
  contactId?: string | null;
  caseId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  dueDate?: string | null;
};

function parseDue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createTask(orgId: string, actorId: string, input: TaskInput) {
  const priority = input.priority === "LOW" || input.priority === "HIGH" ? input.priority : "MEDIUM";
  const task = await db.crmTask.create({
    data: {
      orgId,
      title: input.title.trim().slice(0, 200),
      notes: input.notes?.trim().slice(0, 4000) ?? "",
      assigneeId: input.assigneeId ?? null,
      contactId: input.contactId ?? null,
      caseId: input.caseId ?? null,
      priority,
      dueDate: parseDue(input.dueDate),
      createdBy: actorId,
    },
  });
  await recordActivity({
    orgId, kind: "TASK", summary: `Task created: ${task.title}`,
    contactId: task.contactId, caseId: task.caseId, actorId,
  });
  return task;
}

/** Transition a task's status. Completion stamps `completedAt` once. */
export async function setTaskStatus(orgId: string, actorId: string, taskId: string, status: "OPEN" | "DONE" | "CANCELLED") {
  const task = await db.crmTask.findUnique({ where: { id: taskId } });
  if (!task || task.orgId !== orgId) return null;
  const updated = await db.crmTask.update({
    where: { id: taskId },
    data: { status, completedAt: status === "DONE" ? task.completedAt ?? new Date() : null },
  });
  await recordActivity({
    orgId, kind: "TASK", summary: `Task ${status.toLowerCase()}: ${task.title}`,
    contactId: task.contactId, caseId: task.caseId, actorId,
  });
  return updated;
}

// ── Unified read: CaseTimelineEvent stream for one case ──

/**
 * Read the full timeline for a case: CRM activity rows + the hash-chained
 * CaseEvent ledger, merged, deduped on correlationId, chronologically ordered,
 * and audit-linked. Tenant-scoped (orgId) on every read; caps at 500 rows so
 * the feed cannot become an unbounded dump.
 */
// S5: newest-first reads (the desk opens the latest page, not genesis) with
// an explicit truncation signal — callers can no longer mistake a capped
// 500-row window for the whole history. The projection re-sorts ascending
// internally, so DESC-first fetching never inverts the rendered stream.
export async function readCaseTimeline(orgId: string, caseId: string): Promise<{ events: CaseTimelineEvent[]; truncated: boolean }> {
  const LIMIT = 500;
  const [activities, ledger, audits] = await Promise.all([
    db.activity.findMany({ where: { orgId, caseId }, orderBy: { createdAt: "desc" }, take: LIMIT + 1 }),
    db.caseEvent.findMany({ where: { caseId, case: { orgId } }, orderBy: { occurredAt: "desc" }, take: LIMIT + 1 }),
    db.auditEvent.findMany({ where: { orgId, target: { contains: caseId } }, orderBy: { createdAt: "desc" }, take: LIMIT + 1 }),
  ]);
  const truncated = activities.length > LIMIT || ledger.length > LIMIT || audits.length > LIMIT;
  const normalised: CaseActivity[] = [
    ...activities.slice(0, LIMIT).map((row) => toCaseActivity({
      id: row.id, orgId: row.orgId, kind: row.kind, summary: row.summary,
      contactId: row.contactId, caseId: row.caseId, leadId: row.leadId,
      actorId: row.actorId, createdAt: row.createdAt, metadata: row.metadata,
    })),
    ...ledger.slice(0, LIMIT).map((row) => caseEventToActivity(orgId, caseId, {
      id: row.id, topic: row.topic, payload: row.payload, occurredAt: row.occurredAt,
      actorId: row.actorId, actorLabel: row.actorLabel, correlationId: row.correlationId,
    })),
  ];
  const events = joinAuditToTimeline(
    projectCaseTimeline(normalised),
    audits.slice(0, LIMIT).map((row) => ({
      id: row.id, action: row.action, target: row.target,
      actorLabel: row.actorLabel, actorId: row.actorId, reason: row.reason,
      correlationId: row.correlationId, createdAt: row.createdAt,
    })),
  );
  return { events, truncated };
}
