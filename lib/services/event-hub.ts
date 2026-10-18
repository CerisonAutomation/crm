/**
 * Case event hub — THE single fan-out point for every case mutation.
 *
 * emitCaseEvent(topic, ctx) does, in one observable place:
 *   (a) records an OutboxEvent row (topic prefix "case.") — the canonical
 *       domain-event ledger entry, finalized with delivery counts;
 *   (b) resolves the case + applicant + assigned RM users (CaseAssignment,
 *       falling back to the org's RM pool when nothing is assigned) and fans
 *       out notifyUser() to the applicant AND the RM(s) with precise
 *       human copy per topic — the actor is never notified about their own
 *       action;
 *   (c) starts every PUBLISHED, non-disabled workflow whose trigger pieceKey
 *       matches `trigger.<topic>` via startRun — fire-and-forget, failures
 *       logged, never thrown into the mutation;
 *   (d) mirrors the event onto the automation backend via emitAutomationEvent
 *       (automation.* ledger row).
 *
 * Emission is idempotent per (topic, caseId, dedupeKey) via the IdempotencyKey
 * table: a repeated emission is ledgered as a suppressed duplicate and fans
 * out nothing. The hub contains every event failure — EXCEPT a ledger-integrity
 * failure (R2): when the case event cannot be hash-chained the hub emits
 * INTEGRITY_ALERT and throws, halting the emission instead of reporting
 * success for a mutation that was never chained.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { DOC_TYPE_LABELS, caseStatusLabel } from "@/lib/domain/states";
import type { PlatformSettings } from "@/lib/settings/registry";
import { loadPlatformSettings } from "@/lib/settings/store";
import { notifyUser } from "@/lib/services/notify";
import {
  emitAutomationEvent,
  type AutomationTopic,
} from "@/lib/adapters/automation";
import { startRun, findSubscribedWorkflows } from "@/lib/services/workflow-engine";
import { appendEvent } from "@/lib/services/case-ledger";
import { audit } from "@/lib/api-helpers";

export const CASE_EVENT_TOPICS = [
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
  "document.renew_requested",
  "request.created",
  "request.not_needed",
  "dispatch.created",
  "dispatch.tracking.updated",
  "letter.issued",
  "letter.approved",
  "message.received",
  // consolidated 2026-10-06 — lifecycle intelligence (reminder/triage/booking engines)
  "reminder.created",
  "reminder.due",
  "reminder.escalated",
  "document.expiring",
  "case.stale",
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "booking.no-show",
  "triage.changed",
  // eligibility pre-scan recorded against a case — fans out to the RM queue
  "prescan.completed",
  // KYC re-validation clock — expiring warns, expired routes back to REVIEW
  "kyc.expiring",
  "kyc.expired",
] as const;

export type CaseEventTopic = (typeof CASE_EVENT_TOPICS)[number];

export type CaseEventContext = {
  caseId: string;
  actorId?: string;
  actorLabel?: string;
  /** Topic-specific facts (documentId, docType, reason, trackingId, …). Also merged into run context. */
  meta?: Record<string, unknown>;
  /** Dedupe token — the same (topic, caseId, dedupeKey) fans out only once. */
  dedupeKey?: string;
};

export type CaseEventResult = {
  topic: CaseEventTopic;
  caseId: string;
  duplicated: boolean;
  notified: number;
  recipients: number;
  workflowsMatched: number;
  runsDispatched: number;
  outboxId: string | null;
};

/** Reactive chains (workflow → status change → workflow …) stop at this depth. */
const MAX_HUB_DEPTH = 3;

/** Case-event topics that map to a different legacy automation topic name. */
const AUTOMATION_TOPIC_MAP: Partial<Record<CaseEventTopic, AutomationTopic>> = {
  "letter.issued": "approval.letter.uploaded",
};

// ───────────────────────── recipient copy ─────────────────────────

type RecipientCopy = {
  title: string;
  body: string;
  category: "CASE" | "DOCUMENT";
};
type EventCopy = {
  client: RecipientCopy;
  staff: RecipientCopy;
  data: Record<string, unknown>;
};

type ResolvedCase = {
  id: string;
  reference: string;
  orgId: string;
  clientId: string;
  status: string;
  clientName: string;
};

const metaStr = (
  meta: Record<string, unknown>,
  key: string,
  fallback = ""
): string => {
  const v = meta[key];
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
};
const metaNum = (meta: Record<string, unknown>, key: string): number | null =>
  typeof meta[key] === "number" ? (meta[key] as number) : null;

function buildCopy(
  topic: CaseEventTopic,
  kase: ResolvedCase,
  ctx: CaseEventContext,
  platform: PlatformSettings
): EventCopy {
  const m = ctx.meta ?? {};
  const actor = ctx.actorLabel?.trim() || "the Citizen Lane team";
  const ref = kase.reference;
  const client = kase.clientName;
  // Resolve the label from the admin-editable settings map, falling back to canon.
  const docLabel = (t: string) =>
    platform.labels.docTypes[t] ??
    DOC_TYPE_LABELS[t] ??
    (t ? t.replace(/_/g, " ").toLowerCase() : "Document");
  // Case status labels resolve settings-first, mirroring the doc-type resolution above.
  const statusLabel = (s: string) =>
    platform.labels.caseStatuses[s] ?? caseStatusLabel(s);
  const excerpt = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);

  switch (topic) {
    case "case.created":
      return {
        client: {
          title: "Your Citizen Lane case is open",
          body: `Welcome — your case ${ref} has been created. Your relationship manager will guide you from here.`,
          category: "CASE",
        },
        staff: {
          title: `New case opened — ${ref}`,
          body: `${client} started onboarding — the case awaits assignment and data review.`,
          category: "CASE",
        },
        data: { reference: ref, clientName: client },
      };

    case "case.assigned":
      return {
        client: {
          title: `Your case team — ${ref}`,
          body: `${metaStr(
            m,
            "assigneeName",
            "A relationship manager"
          )} now looks after your case ${ref}.`,
          category: "CASE",
        },
        staff: {
          title: `Case team updated — ${ref}`,
          body: `${metaStr(
            m,
            "assigneeName",
            "A new RM"
          )} was assigned to ${client}'s case by ${actor}.`,
          category: "CASE",
        },
        data: {
          reference: ref,
          assigneeId: metaStr(m, "assigneeId") || null,
          assigneeName: metaStr(m, "assigneeName") || null,
        },
      };

    case "case.status.changed": {
      const from = metaStr(m, "from", kase.status);
      const to = metaStr(m, "to", kase.status);
      const reason = metaStr(m, "reason");
      const command = metaStr(m, "command");
      return {
        client: {
          title: `Case ${ref} — status update`,
          body: `Your case moved to “${statusLabel(to)}”.${
            reason ? ` Note: ${reason}` : ""
          }`,
          category: "CASE",
        },
        staff: {
          title: `Case ${ref} → ${statusLabel(to)}`,
          body: `${statusLabel(from)} → ${statusLabel(to)}${
            command ? ` (${command})` : ""
          } by ${actor}.${reason ? ` — ${reason}` : ""}`,
          category: "CASE",
        },
        data: {
          reference: ref,
          from,
          to,
          command: command || null,
          reason: reason || null,
        },
      };
    }

    case "case.data.approved":
    case "case.data.rejected": {
      const approved = topic === "case.data.approved";
      const reason = metaStr(m, "reason");
      return {
        client: approved
          ? {
              title: "Personal data verified",
              body: "Your personal details were verified by your relationship manager.",
              category: "CASE",
            }
          : {
              title: "Your data needs attention",
              body:
                reason ||
                "Your relationship manager requested changes to your personal data — see your dashboard.",
              category: "CASE",
            },
        staff: {
          title: `Data approval: ${
            approved ? "APPROVED" : "REJECTED"
          } — ${ref}`,
          body: `${actor} ${
            approved ? "approved" : "rejected"
          } ${client}'s personal data${reason ? ` — ${reason}` : "."}`,
          category: "CASE",
        },
        data: {
          reference: ref,
          decision: approved ? "APPROVED" : "REJECTED",
          reason: reason || null,
        },
      };
    }

    case "case.service.selected": {
      const programme = metaStr(m, "programme", "a programme");
      return {
        client: {
          title: `Programme selected — ${ref}`,
          body: `You chose ${programme}. Your relationship manager will confirm the engagement shortly.`,
          category: "CASE",
        },
        staff: {
          title: `Programme choice needs approval — ${ref}`,
          body: `${client} selected ${programme} — awaiting your secondary approval.`,
          category: "CASE",
        },
        data: {
          reference: ref,
          programme,
          programmeKey: metaStr(m, "programmeKey") || null,
        },
      };
    }

    case "case.service.approved":
    case "case.service.rejected": {
      const approved = topic === "case.service.approved";
      const programme = metaStr(m, "programme", "the selected programme");
      const reason = metaStr(m, "reason");
      return {
        client: approved
          ? {
              title: "Programme approved",
              body: `Your ${programme} engagement is approved — the standard document set has been issued. See your dashboard.`,
              category: "CASE",
            }
          : {
              title: "Programme choice needs discussion",
              body:
                reason ||
                "Your relationship manager would like to discuss your programme selection.",
              category: "CASE",
            },
        staff: {
          title: `Service approval: ${
            approved ? "APPROVED" : "REJECTED"
          } — ${ref}`,
          body: `${actor} ${
            approved ? "approved" : "declined"
          } ${programme} for ${client}${reason ? ` — ${reason}` : "."}${
            approved ? " Standard document set issued." : ""
          }`,
          category: "CASE",
        },
        data: {
          reference: ref,
          programme,
          decision: approved ? "APPROVED" : "REJECTED",
          reason: reason || null,
        },
      };
    }

    case "document.uploaded": {
      const docType = metaStr(m, "docType");
      const fileName = metaStr(m, "fileName", "a document");
      const failed = m.ocrFailed === true;
      const fields = metaNum(m, "ocrFields");
      const provider = metaStr(m, "ocrProvider");
      const ocrNote = failed
        ? "OCR could not read it — manual verification required."
        : fields !== null
        ? `OCR extracted ${fields} field${fields === 1 ? "" : "s"}${
            provider ? ` (${provider})` : ""
          }.`
        : "";
      return {
        client: {
          title: `We received your ${docLabel(docType)}`,
          body: `Thank you — ${fileName} is safely in the document vault and will be verified shortly.`,
          category: "DOCUMENT",
        },
        staff: {
          title: `${docLabel(docType)} uploaded — ${client}'s case ${ref}`,
          body: `${fileName} was uploaded by ${actor}. ${ocrNote}`.trim(),
          category: "DOCUMENT",
        },
        data: {
          reference: ref,
          documentId: metaStr(m, "documentId") || null,
          docType,
          fileName,
          ocrFields: fields,
          ocrProvider: provider || null,
          ocrFailed: failed,
        },
      };
    }

    case "document.confirmed": {
      const docTitle = metaStr(m, "docTitle", "Document");
      return {
        client: {
          title: "Document details confirmed",
          body: `You confirmed the details of “${docTitle}” — our team now takes over the verification.`,
          category: "DOCUMENT",
        },
        staff: {
          title: `${
            metaStr(m, "docType", "")
              ? docLabel(metaStr(m, "docType"))
              : "Document"
          } confirmed — ${ref}`,
          body: `${client} confirmed the extracted data for “${docTitle}” — ready for review.`,
          category: "DOCUMENT",
        },
        data: {
          reference: ref,
          documentId: metaStr(m, "documentId") || null,
          docTitle,
        },
      };
    }

    case "document.approved":
    case "document.rejected":
    case "document.changes_requested": {
      const docTitle = metaStr(m, "docTitle", "Your document");
      const reason = metaStr(m, "reason");
      if (topic === "document.approved") {
        return {
          client: {
            title: "Your document was approved",
            body: `“${docTitle}” passed verification${
              reason ? ` — ${reason}` : ". No further action is needed."
            }`,
            category: "DOCUMENT",
          },
          staff: {
            title: `Document approved — ${ref}`,
            body: `${docTitle} was approved by ${actor}.`,
            category: "DOCUMENT",
          },
          data: {
            reference: ref,
            documentId: metaStr(m, "documentId") || null,
            docType: metaStr(m, "docType") || null,
            docTitle,
            decision: "APPROVED",
            reason: reason || null,
          },
        };
      }
      if (topic === "document.rejected") {
        return {
          client: {
            title: "Action needed: document rejected",
            body: `“${docTitle}” was not accepted: ${
              reason || "please contact your relationship manager"
            }.`,
            category: "DOCUMENT",
          },
          staff: {
            title: `Document rejected — ${ref}`,
            body: `${docTitle} was rejected by ${actor}${
              reason ? ` — ${reason}` : "."
            }`,
            category: "DOCUMENT",
          },
          data: {
            reference: ref,
            documentId: metaStr(m, "documentId") || null,
            docType: metaStr(m, "docType") || null,
            docTitle,
            decision: "REJECTED",
            reason: reason || null,
          },
        };
      }
      return {
        client: {
          title: "Changes requested for your document",
          body: `“${docTitle}”: ${
            reason ||
            "please review the instructions and upload an updated version."
          }`,
          category: "DOCUMENT",
        },
        staff: {
          title: `Changes requested — ${ref}`,
          body: `${docTitle}: ${reason || "reviewer requested changes"}.`,
          category: "DOCUMENT",
        },
        data: {
          reference: ref,
          documentId: metaStr(m, "documentId") || null,
          docType: metaStr(m, "docType") || null,
          docTitle,
          decision: "REQUEST_CHANGES",
          reason: reason || null,
        },
      };
    }

    case "request.created": {
      const title = metaStr(m, "title", "Document request");
      const instructions = metaStr(m, "instructions");
      const batch = Array.isArray(m.batch) ? (m.batch as string[]) : null;
      const detail = batch ? batch.join(", ") : instructions;
      return {
        client: {
          title: batch
            ? "Standard document set requested"
            : `${title} — document requested`,
          body: batch
            ? `Your relationship manager requested the standard document set: ${detail}. See your dashboard for instructions.`
            : `${title}: ${
                instructions || "please upload the requested document."
              }`,
          category: "DOCUMENT",
        },
        staff: {
          title: `Document request sent — ${ref}`,
          body: `${title} requested from ${client} by ${actor}.${
            detail ? ` (${detail})` : ""
          }`,
          category: "DOCUMENT",
        },
        data: {
          reference: ref,
          requestId: metaStr(m, "requestId") || null,
          title,
          docType: metaStr(m, "docType") || null,
          batch: batch ?? null,
        },
      };
    }

    case "request.not_needed": {
      const reason = metaStr(m, "reason");
      return {
        client: {
          title: "Document request closed",
          body: "This document request was marked as not needed — no action is required from you.",
          category: "DOCUMENT",
        },
        staff: {
          title: `Document request closed — ${ref}`,
          body: `${actor} marked a document request as not needed for ${client}${
            reason ? ` — ${reason}` : ""
          }.`,
          category: "DOCUMENT",
        },
        data: {
          reference: ref,
          requestId: metaStr(m, "requestId") || null,
          reason: reason || null,
        },
      };
    }

    case "dispatch.created": {
      const trackingId = metaStr(m, "trackingId", "pending");
      const destination = metaStr(m, "destination", "the authority");
      return {
        client: {
          title: "Your documents are on their way",
          body: `Your dossier is on its way to ${destination} via ${metaStr(
            m,
            "carrier",
            "DHL"
          )} (tracking ${trackingId}).`,
          category: "CASE",
        },
        staff: {
          title: `DHL dispatch created — ${ref}`,
          body: `Tracking ${trackingId} → ${destination}, created by ${actor} (${metaStr(
            m,
            "carrier",
            "DHL"
          )} sandbox adapter).`,
          category: "CASE",
        },
        data: {
          reference: ref,
          trackingId,
          destination,
          carrier: metaStr(m, "carrier", "DHL"),
          documentIds: Array.isArray(m.documentIds)
            ? (m.documentIds as string[])
            : null,
        },
      };
    }

    case "letter.issued": {
      const version = metaNum(m, "version");
      return {
        client: {
          title: "Approval in principle",
          body: "Your approval-in-principle letter is ready to download from your dashboard.",
          category: "CASE",
        },
        staff: {
          title: `Approval letter issued — ${ref}`,
          body: `${metaStr(m, "fileName", "Letter")}${
            version !== null ? ` (v${version})` : ""
          } issued for ${client} by ${actor}.`,
          category: "CASE",
        },
        data: {
          reference: ref,
          letterId: metaStr(m, "letterId") || null,
          fileName: metaStr(m, "fileName") || null,
          version,
        },
      };
    }

    case "message.received": {
      const text = metaStr(m, "excerpt");
      const fromClient = metaStr(m, "senderRole") === "CLIENT";
      return {
        client: {
          title: fromClient
            ? `Your message on ${ref}`
            : "New message from your RM",
          body: fromClient
            ? `Your message on case ${ref} was delivered to your relationship manager.`
            : `${actor}: ${excerpt(text || "sent you a message.")}`,
          category: "CASE",
        },
        staff: fromClient
          ? {
              title: `New message from ${client} — ${ref}`,
              body: excerpt(text || "A new message awaits your reply."),
              category: "CASE",
            }
          : {
              title: `Message on case ${ref}`,
              body: `${actor} wrote to the client: ${excerpt(text)}`,
              category: "CASE",
            },
        data: {
          reference: ref,
          messageId: metaStr(m, "messageId") || null,
          senderRole: metaStr(m, "senderRole") || null,
          excerpt: text,
        },
      };
    }
    default: {
      // Lifecycle topics (reminder/booking/triage/…): generic copy — no
      // bespoke wording, still ledgered + fanned out to trigger.* workflows.
      // Reminder events carry a human `reminderTitle`; surface it so a bell
      // full of reminders reads as distinct items instead of N identical
      // "reminder created" rows for the same case.
      const label = topic.replace(/[._]/g, " ");
      const detail = metaStr(m, "reminderTitle");
      const subject = detail || label;
      return {
        client: {
          title: detail ? `${detail} — ${ref}` : `Update on ${ref}`,
          body: `${actor}: ${subject}.`,
          category: "CASE",
        },
        staff: {
          title: `${subject} — ${ref}`,
          body: `${actor}: ${subject} for ${client}.`,
          category: "CASE",
        },
        data: { reference: ref },
      };
    }
  }
}

// ───────────────────────── the hub ─────────────────────────

/**
 * Fan out a case mutation: ledger → notifications (applicant + RMs, actor
 * excluded) → subscribed workflow runs → automation backend. Contained on
 * every event failure; throws ONLY on ledger-integrity failure (R2 halt).
 */
export async function emitCaseEvent(
  topic: CaseEventTopic,
  ctx: CaseEventContext
): Promise<CaseEventResult> {
  const base: CaseEventResult = {
    topic,
    caseId: ctx.caseId,
    duplicated: false,
    notified: 0,
    recipients: 0,
    workflowsMatched: 0,
    runsDispatched: 0,
    outboxId: null,
  };

  try {
    // Resolve the case + applicant once — everything below hangs off it.
    const row = await db.case.findUnique({
      where: { id: ctx.caseId },
      select: {
        id: true,
        reference: true,
        orgId: true,
        clientId: true,
        status: true,
        client: { select: { name: true, firstName: true, lastName: true } },
      },
    });
    if (!row) {
      console.error(
        `[event-hub] ${topic}: case ${ctx.caseId} not found — event dropped`
      );
      return base;
    }
    const kase: ResolvedCase = {
      id: row.id,
      reference: row.reference,
      orgId: row.orgId,
      clientId: row.clientId,
      status: row.status,
      clientName:
        row.client.name?.trim() ||
        [row.client.firstName, row.client.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "the applicant",
    };

    const occurredAt = new Date().toISOString();
    const correlationId = `cev-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    // Read the platform settings ONCE for this event (resilient — canon on failure).
    const platform = await loadPlatformSettings();
    const copy = buildCopy(topic, kase, ctx, platform);
    const payload = {
      event: `case.${topic}`,
      occurredAt,
      caseId: kase.id,
      caseReference: kase.reference,
      actorId: ctx.actorId ?? null,
      actor: ctx.actorLabel ?? null,
      data: copy.data,
    };

    // (a) Reserve the idempotency key and create the canonical outbox row in
    // one transaction. A crash cannot leave a claimed event without a ledger
    // row (or a row that was never claimed).
    let outbox: { id: string };
    try {
      const reserved = await db.$transaction(async (tx) => {
        const key = ctx.dedupeKey
          ? `caseevt:${topic}:${kase.id}:${ctx.dedupeKey}`
          : null;
        if (key)
          await tx.idempotencyKey.create({ data: { key, scope: "event-hub" } });
        const created = await tx.outboxEvent.create({
          data: {
            topic: `case.${topic}`,
            payload: JSON.stringify(payload),
            status: "PENDING",
            correlationId,
          },
        });
        if (key)
          await tx.idempotencyKey.update({
            where: { key },
            data: { resultRef: created.id },
          });
        return { key, created };
      });
      outbox = reserved.created;
    } catch {
      if (!ctx.dedupeKey)
        throw new Error("event hub outbox transaction failed");
      const key = `caseevt:${topic}:${kase.id}:${ctx.dedupeKey}`;
      const existing = await db.idempotencyKey
        .findUnique({ where: { key }, select: { key: true } })
        .catch(() => null);
      if (!existing)
        throw new Error("event hub reservation transaction failed");
      // Unique-key conflict means another request won the reservation. Keep
      // the duplicate observable without replaying any fan-out side effects.
      await db.outboxEvent
        .create({
          data: {
            topic: `case.${topic}`,
            payload: JSON.stringify({
              event: `case.${topic}`,
              occurredAt,
              caseId: kase.id,
              caseReference: kase.reference,
              dedupeKey: ctx.dedupeKey,
              delivery: "duplicate suppressed (idempotency key)",
            }),
            status: "PROCESSED",
            attempts: 1,
            processedAt: new Date(),
          },
        })
        .catch(() => undefined);
      return { ...base, duplicated: true };
    }

    // (a2) Append to the hash-chained case event ledger FIRST (spec §2 / R2,
    // PERF-3 append-first-then-fanout). A ledger failure HALTS the emission
    // here — the hub emits INTEGRITY_ALERT and throws BEFORE any notification,
    // workflow run, or automation mirror goes out, so a mutation that was
    // never chained can never leave ghost notifications behind. Every other
    // event failure stays contained (a failing notification never breaks the
    // mutation).
    try {
      await appendEvent({
        caseId: kase.id,
        topic: `case.${topic}`,
        payload,
        actorId: ctx.actorId ?? null,
        actorLabel: ctx.actorLabel ?? null,
        correlationId,
      });
    } catch (err) {
      console.error(
        `[event-hub] ledger append failed (case.${topic}) — halting emission`,
        err
      );
      await audit({
        orgId: kase.orgId,
        actorId: ctx.actorId ?? null,
        actorLabel: ctx.actorLabel ?? "event-hub",
        action: "ledger.INTEGRITY_ALERT",
        target: kase.id,
        reason: `case.${topic} could not be hash-chained; emission halted`,
        correlationId,
      });
      throw err instanceof Error ? err : new Error("Case ledger append failed");
    }

    // (b) fan out notifications — applicant + assigned RMs (org RM pool when
    // nothing is assigned). The actor is never notified about their own action.
    const assignments = await db.caseAssignment.findMany({
      where: { caseId: kase.id },
      select: { userId: true },
    });
    let staffIds = assignments.map((a) => a.userId);
    if (staffIds.length === 0) {
      const pool = await db.user.findMany({
        where: {
          orgId: kase.orgId,
          role: { in: ["RM", "SENIOR_RM"] },
          status: "ACTIVE",
        },
        select: { id: true },
      });
      staffIds = pool.map((u) => u.id);
    }
    let delivered = 0;
    const deliver = async (userId: string, c: RecipientCopy): Promise<void> => {
      if (ctx.actorId && userId === ctx.actorId) return; // no self-notifications
      try {
        await notifyUser({
          userId,
          title: c.title,
          body: c.body,
          category: c.category,
          caseId: kase.id,
        });
        delivered++;
      } catch (err) {
        console.error(`[event-hub] notify failed (${topic} → ${userId})`, err);
      }
    };
    // Bounded parallel batches (5): sequential fan-out made notification
    // latency linear in org size; unbounded Promise.all would spike the
    // notification provider. Per-recipient failures stay contained in deliver.
    const NOTIFY_BATCH = 5;
    const jobs: Array<() => Promise<void>> = [
      () => deliver(kase.clientId, copy.client),
      ...staffIds.map((staffId) => () => deliver(staffId, copy.staff)),
    ];
    for (let i = 0; i < jobs.length; i += NOTIFY_BATCH) {
      await Promise.all(jobs.slice(i, i + NOTIFY_BATCH).map((run) => run()));
    }
    const recipients = [kase.clientId, ...staffIds].filter(
      (id) => id !== ctx.actorId
    ).length;
    const notified = delivered;

    // (c) start every PUBLISHED, non-disabled workflow subscribed to trigger.<topic>.
    const depth =
      typeof ctx.meta?.__hubDepth === "number"
        ? (ctx.meta.__hubDepth as number)
        : 0;
    let workflowsMatched = 0;
    const dispatchPromises: Array<Promise<boolean>> = [];
    let fanoutNote: string | null = null;
    if (depth >= MAX_HUB_DEPTH) {
      fanoutNote = `workflow fan-out suppressed (hub depth ${depth} ≥ cap ${MAX_HUB_DEPTH}) — reactive chain stopped`;
    } else {
      const pieceKey = `trigger.${topic}`;
      const subscribed = await findSubscribedWorkflows(pieceKey, { orgId: kase.orgId });
      for (const [workflowId, { name, currentVersion }] of subscribed) {
        workflowsMatched++;
        dispatchPromises.push(
          startRun({
            workflowId,
            caseId: kase.id,
            trigger: topic,
            context: {
              caseId: kase.id,
              reference: kase.reference,
              topic,
              actor: ctx.actorLabel ?? "system",
              correlationId,
              ...(ctx.meta ?? {}),
              __hubDepth: depth + 1,
            },
            actorLabel: ctx.actorLabel,
            correlationId,
          }).then(
            () => true,
            (err) => {
              console.error(
                `[event-hub] run failed (${name} on ${topic})`,
                err
              );
              return false;
            }
          )
        );
      }
    }
    // Settle the fan-out: runsDispatched counts runs that actually started.
    // allSettled never throws (each promise already maps errors to false),
    // so the mutation still cannot fail with a run — it only waits.
    const dispatchResults = await Promise.all(dispatchPromises);
    const runsDispatched = dispatchResults.filter(Boolean).length;

    // (d) mirror onto the automation backend — separate automation.* ledger row.
    // mirrored: true — the hub already started runs above (c), so the backend
    // must not start them again (reminder bridge: only NON-mirrored entries
    // of reminder topics fan out in-app).
    void emitAutomationEvent(
      AUTOMATION_TOPIC_MAP[topic] ?? (topic as AutomationTopic),
      copy.data,
      {
        caseId: kase.id,
        actor: ctx.actorLabel,
        correlationId,
        orgId: kase.orgId,
        mirrored: true,
      }
    ).catch(() => undefined);

    // Finalize the outbox row with the delivery facts (the ledger append
    // already happened up front in (a2) — this only records what the fan-out
    // did).
    if (outbox) {
      await db.outboxEvent
        .update({
          where: { id: outbox.id },
          data: {
            status: "PROCESSED",
            attempts: { increment: 1 },
            processedAt: new Date(),
            payload: JSON.stringify({
              ...payload,
              delivery: {
                notified,
                recipients,
                workflowsMatched,
                runsDispatched,
                correlationId,
                ...(fanoutNote ? { note: fanoutNote } : {}),
              },
            }),
          },
        })
        .catch(() => undefined);
    }
    console.warn(
      `[event-hub] case.${topic} — case ${
        kase.reference
      }, notified ${notified}/${recipients}, workflows matched ${workflowsMatched}, dispatched ${runsDispatched}${
        fanoutNote ? ` (${fanoutNote})` : ""
      }`
    );
    return {
      ...base,
      notified,
      recipients,
      workflowsMatched,
      runsDispatched,
      outboxId: outbox?.id ?? null,
    };
  } catch (err) {
    // A failing event never breaks the mutation that caused it.
    console.error(`[event-hub] emitCaseEvent(${topic}) failed`, err);
    return base;
  }
}
