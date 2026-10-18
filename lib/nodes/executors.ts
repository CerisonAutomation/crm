/**
 * Node executors — the server-side counterpart of catalog.ts.
 *
 * Every pieceKey in the catalog binds here to a `preview` (dry-run, no side
 * effects) and an `execute` (real side effects). Executors are self-contained:
 * they only depend on the run context + the integrations layer, never on each
 * other. The engine resolves through the registry — unknown pieceKeys fall
 * back to a sandbox no-op so old graphs never crash.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import { sendEmail, sendWhatsApp } from "@/lib/integrations";
import { assertPublicWebhookTarget } from "@/lib/integrations/webhooks";
import {
  createShipment,
  getTrackingEvents,
  getLabel,
} from "@/lib/adapters/dhl-real";
import { scrubPII, scrubString, isTrustedRelayUrl } from "@/lib/domain/pii";

export type RunContext = Record<string, unknown>;

export type ExecutorResult = {
  output: RunContext;
  waitForApproval?: boolean;
  waitForWorkflow?: { workflowId: string; runId?: string };
};

export type ExecutorCallOpts = {
  /**
   * Abort signal for the engine timeout budget. Best-effort: executors with
   * cancellable I/O (fetch) honour it; pure/db-only executors finish fast
   * and ignore it. Late side effects stay safe via the R3 step dedupe.
   */
  signal?: AbortSignal;
};

export type Executor = {
  preview: (
    config: Record<string, unknown>,
    ctx: RunContext
  ) => RunContext | Promise<RunContext>;
  execute: (
    config: Record<string, unknown>,
    ctx: RunContext,
    opts?: ExecutorCallOpts
  ) => Promise<ExecutorResult>;
  /**
   * Optional per-executor overrides for the catalog contract
   * (`nodeContractFor` in catalog.ts is the source of truth; an executor may
   * narrow its own timeout here and the engine honours the smaller budget).
   */
  timeoutMs?: number;
  version?: number;
};

const str = (v: unknown, fallback = ""): string =>
  v === undefined || v === null ? fallback : String(v);
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** {{field}} interpolation against the run context. */
function interpolate(template: string, ctx: RunContext): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) =>
    str(ctx[key])
  );
}

async function caseWithClient(ctx: RunContext) {
  const caseId = str(ctx.caseId) || undefined;
  if (!caseId) return null;
  return db.case.findUnique({
    where: { id: caseId },
    select: {
      reference: true,
      clientId: true,
      client: { select: { email: true, phone: true, name: true } },
    },
  });
}

function unitToMs(unit: string): number {
  switch (unit.toUpperCase()) {
    case "MINUTES":
      return 60_000;
    case "HOURS":
      return 3_600_000;
    case "DAYS":
      return 86_400_000;
    case "WEEKS":
      return 7 * 86_400_000;
    default:
      return 86_400_000;
  }
}

/**
 * Cancellation contract (abort-threading): the engine passes an AbortSignal
 * that fires when the node timeout budget lapses.
 *
 * HONOURS the signal: `action.http.webhook` (links the outer signal to its
 * own 8s fetch controller — an engine TIMEOUT actually cancels the send).
 *
 * SELF-BOUNDED (own timeout, outer signal not threaded — deliberately):
 * `action.email.send` / `action.whatsapp.send` (integrations own controllers),
 * `action.ai.compose` (aiChat 30s budget; server-side it resolves null fast),
 * `action.dhl.*` (dhl-real `AbortSignal.timeout(15s)` per call).
 *
 * NON-CANCELLABLE BY NATURE (no long I/O — pure compute or short local
 * writes): all `trigger.*`, `condition.*`, `approval.human.gate`,
 * `wait.workflow`, `delay.*`, `action.create.request`, `action.audit.export`,
 * `action.notify.*`, `action.case.transition`.
 *
 * Safety net for every class: a late side effect that lands after TIMEOUT is
 * converged by the R3 step dedupe (replay, never re-execute), and retries
 * create a new attempt row — so abort is an optimisation, never a
 * correctness dependency.
 */
export const EXECUTORS: Record<string, Executor> = {
  // ── Triggers (no-op — the engine marks them on entry) ──
  "trigger.manual": {
    preview: () => ({ triggered: true }),
    execute: async () => ({
      output: { triggered: true, trigger: "trigger.manual" },
    }),
  },
  "trigger.case.created": {
    preview: () => ({ triggered: true }),
    execute: async () => ({
      output: { triggered: true, trigger: "trigger.case.created" },
    }),
  },
  "trigger.document.uploaded": {
    preview: () => ({ triggered: true }),
    execute: async () => ({
      output: { triggered: true, trigger: "trigger.document.uploaded" },
    }),
  },
  "trigger.page.submitted": {
    preview: () => ({ triggered: true }),
    execute: async () => ({
      output: { triggered: true, trigger: "trigger.page.submitted" },
    }),
  },
  "trigger.schedule.due": {
    preview: () => ({ triggered: true }),
    execute: async () => ({
      output: { triggered: true, trigger: "trigger.schedule.due" },
    }),
  },
  "trigger.document.approved": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.document.approved",
        caseId: str(ctx.caseId) || undefined,
        documentId: str(ctx.documentId) || undefined,
        decision: str(ctx.decision, "APPROVED"),
      },
    }),
  },
  "trigger.document.rejected": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.document.rejected",
        caseId: str(ctx.caseId) || undefined,
        documentId: str(ctx.documentId) || undefined,
        decision: str(ctx.decision, "REJECTED"),
      },
    }),
  },
  "trigger.case.status.changed": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.status.changed",
        caseId: str(ctx.caseId) || undefined,
        from: str(ctx.from) || undefined,
        to: str(ctx.to) || undefined,
      },
    }),
  },
  "trigger.dispatch.created": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.dispatch.created",
        caseId: str(ctx.caseId) || undefined,
        trackingId: str(ctx.trackingId) || undefined,
      },
    }),
  },
  "trigger.dispatch.tracking.updated": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.dispatch.tracking.updated",
        caseId: str(ctx.caseId) || undefined,
        trackingId: str(ctx.trackingId) || undefined,
        status: str(ctx.status) || undefined,
      },
    }),
  },
  "trigger.letter.issued": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.letter.issued",
        caseId: str(ctx.caseId) || undefined,
        letterId: str(ctx.letterId) || undefined,
      },
    }),
  },
  "trigger.message.received": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.message.received",
        caseId: str(ctx.caseId) || undefined,
        messageId: str(ctx.messageId) || undefined,
      },
    }),
  },
  "trigger.reminder.due": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.reminder.due",
        caseId: str(ctx.caseId) || undefined,
        reminderId: str(ctx.reminderId) || undefined,
      },
    }),
  },
  "trigger.document.expiring": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.document.expiring",
        caseId: str(ctx.caseId) || undefined,
        documentId: str(ctx.documentId) || undefined,
      },
    }),
  },
  "trigger.case.stale": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.stale",
        caseId: str(ctx.caseId) || undefined,
      },
    }),
  },
  "trigger.case.assigned": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.assigned",
        caseId: str(ctx.caseId) || undefined,
        assigneeId: str(ctx.assigneeId) || undefined,
      },
    }),
  },
  "trigger.case.data.approved": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.data.approved",
        caseId: str(ctx.caseId) || undefined,
        decision: str(ctx.decision, "APPROVED"),
      },
    }),
  },
  "trigger.case.data.rejected": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.data.rejected",
        caseId: str(ctx.caseId) || undefined,
        decision: str(ctx.decision, "REJECTED"),
      },
    }),
  },
  "trigger.case.service.selected": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.service.selected",
        caseId: str(ctx.caseId) || undefined,
        service: str(ctx.service) || undefined,
      },
    }),
  },
  "trigger.case.service.approved": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.service.approved",
        caseId: str(ctx.caseId) || undefined,
        decision: str(ctx.decision, "APPROVED"),
      },
    }),
  },
  "trigger.case.service.rejected": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.case.service.rejected",
        caseId: str(ctx.caseId) || undefined,
        decision: str(ctx.decision, "REJECTED"),
      },
    }),
  },
  "trigger.document.confirmed": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.document.confirmed",
        caseId: str(ctx.caseId) || undefined,
        documentId: str(ctx.documentId) || undefined,
      },
    }),
  },
  "trigger.document.changes_requested": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.document.changes_requested",
        caseId: str(ctx.caseId) || undefined,
        documentId: str(ctx.documentId) || undefined,
      },
    }),
  },
  "trigger.request.created": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.request.created",
        caseId: str(ctx.caseId) || undefined,
        requestId: str(ctx.requestId) || undefined,
      },
    }),
  },
  "trigger.reminder.created": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.reminder.created",
        caseId: str(ctx.caseId) || undefined,
        reminderId: str(ctx.reminderId) || undefined,
      },
    }),
  },
  "trigger.reminder.escalated": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.reminder.escalated",
        caseId: str(ctx.caseId) || undefined,
        reminderId: str(ctx.reminderId) || undefined,
      },
    }),
  },
  "trigger.booking.created": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.booking.created",
        caseId: str(ctx.caseId) || undefined,
        bookingId: str(ctx.bookingId) || undefined,
      },
    }),
  },
  "trigger.booking.confirmed": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.booking.confirmed",
        caseId: str(ctx.caseId) || undefined,
        bookingId: str(ctx.bookingId) || undefined,
      },
    }),
  },
  "trigger.booking.cancelled": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.booking.cancelled",
        caseId: str(ctx.caseId) || undefined,
        bookingId: str(ctx.bookingId) || undefined,
      },
    }),
  },
  "trigger.triage.changed": {
    preview: () => ({ triggered: true }),
    execute: async (_c, ctx) => ({
      output: {
        triggered: true,
        trigger: "trigger.triage.changed",
        caseId: str(ctx.caseId) || undefined,
      },
    }),
  },

  // ── Logic ──
  "condition.field.equals": {
    preview: (c) => ({ matched: str(c.value) !== "" }),
    execute: async (c, ctx) => ({
      output: { matched: str(ctx[str(c.left)]) === str(c.value) },
    }),
  },
  "condition.field.exists": {
    preview: (c) => ({ matched: str(c.left) !== "" }),
    execute: async (c, ctx) => {
      const v = ctx[str(c.left)];
      const matched = v !== undefined && v !== null && v !== "";
      return { output: { matched } };
    },
  },
  "delay.duration": {
    preview: (c) => {
      const amount = num(c.amount, 1);
      const unit = str(c.unit, "WEEKS");
      return {
        dryRun: true,
        wouldScheduleFor: new Date(
          Date.now() + amount * unitToMs(unit)
        ).toISOString(),
      };
    },
    execute: async (c, ctx) => {
      const amount = num(c.amount, 1);
      const unit = str(c.unit, "WEEKS");
      const dueDate = new Date(Date.now() + amount * unitToMs(unit));
      const caseId = str(ctx.caseId) || undefined;
      if (caseId) {
        const dispatch = await db.dispatch.findFirst({
          where: { caseId },
          orderBy: { createdAt: "desc" },
        });
        if (dispatch) {
          await db.followUp.create({
            data: {
              dispatchId: dispatch.id,
              caseId,
              dueDate,
              note:
                str(c.note, `Follow up after ${amount} ${unit.toLowerCase()}`) +
                " (scheduled by workflow)",
            },
          });
        }
      }
      return { output: { scheduledFor: dueDate.toISOString() } };
    },
  },
  "delay.authority_followup": {
    preview: (c) => ({
      dryRun: true,
      wouldScheduleFor: new Date(
        Date.now() + num(c.weeks, 6) * 7 * 86_400_000
      ).toISOString(),
    }),
    execute: async (c, ctx) => {
      const weeks = num(c.weeks, 6);
      const dueDate = new Date(Date.now() + weeks * 7 * 86_400_000);
      const caseId = str(ctx.caseId) || undefined;
      if (caseId) {
        const dispatch = await db.dispatch.findFirst({
          where: { caseId },
          orderBy: { createdAt: "desc" },
        });
        if (dispatch) {
          await db.followUp.create({
            data: {
              dispatchId: dispatch.id,
              caseId,
              dueDate,
              note: `Follow up with authority after ${weeks} weeks (scheduled by workflow)`,
            },
          });
        }
      }
      return { output: { scheduledFor: dueDate.toISOString() } };
    },
  },
  "wait.workflow": {
    preview: (c) => ({
      dryRun: true,
      wouldWaitFor: str(c.workflowId),
      runId: str(c.runId) || "any",
    }),
    execute: async (c, ctx) => {
      const workflowId = str(c.workflowId);
      const runId = str(c.runId) || undefined;
      if (!workflowId) {
        return {
          output: { waitedFor: false, reason: "no workflowId provided" },
        };
      }
      // Pause the run — the engine will resume it when the target workflow completes
      // Use waitForWorkflow (not waitForApproval) so the UI doesn't show this as an approval gate
      return {
        output: {
          waitedFor: workflowId,
          completedRunId: runId || null,
          waiting: true,
        },
        waitForWorkflow: { workflowId, runId },
      };
    },
  },

  // ── Communication: in-app notifications ──
  "action.notify.client": {
    preview: (c) => ({
      dryRun: true,
      wouldNotify: "client",
      title: str(c.title, "Case update"),
    }),
    execute: async (c, ctx) => {
      const { notifyUser } = await import("@/lib/services/notify");
      const cwc = await caseWithClient(ctx);
      if (!cwc)
        return {
          output: {
            notified: "client",
            skipped: true,
            reason: "no case in run context",
          },
        };
      await notifyUser({
        userId: cwc.clientId,
        title: interpolate(str(c.title, "Case update"), ctx),
        body: interpolate(
          str(c.body, `Your case ${cwc.reference} has an update.`),
          ctx
        ),
        caseId: str(ctx.caseId),
      });
      return { output: { notified: "client" } };
    },
  },
  "action.notify.rm": {
    preview: (c) => ({
      dryRun: true,
      wouldNotify: "RM team",
      title: str(c.title, "Case action needed"),
    }),
    execute: async (c, ctx) => {
      const { notifyUser } = await import("@/lib/services/notify");
      const title = interpolate(str(c.title, "Case action needed"), ctx);
      const caseId = str(ctx.caseId) || undefined;
      const cwc = await caseWithClient(ctx);
      const rms = await db.user.findMany({
        where: { role: { in: ["RM", "SENIOR_RM"] }, status: "ACTIVE" },
        select: { id: true },
      });
      const targets = new Set<string>(rms.map((r) => r.id));
      if (cwc && caseId) {
        const assignments = await db.caseAssignment.findMany({
          where: { caseId },
          select: { userId: true },
        });
        for (const a of assignments) targets.add(a.userId);
      }
      for (const t of targets) {
        await notifyUser({
          userId: t,
          title,
          body: str(
            c.body,
            cwc
              ? `Case ${cwc.reference} requires attention.`
              : str(ctx.page, "")
              ? `New enquiry on page “${str(ctx.page)}” from ${str(
                  ctx.name,
                  "a visitor"
                )}.`
              : "A workflow requires attention."
          ),
          caseId,
        });
      }
      return { output: { notified: "rm", recipients: targets.size } };
    },
  },
  "action.notify.role": {
    preview: (c) => ({
      dryRun: true,
      wouldNotify: str(c.role, "RM"),
      title: str(c.title, "Workflow update"),
    }),
    execute: async (c, ctx) => {
      const { notifyUser } = await import("@/lib/services/notify");
      const role = str(c.role, "RM");
      const users = await db.user.findMany({
        where: { role: role as never, status: "ACTIVE" },
        select: { id: true },
      });
      for (const u of users) {
        await notifyUser({
          userId: u.id,
          title: interpolate(str(c.title, "Workflow update"), ctx),
          body: interpolate(
            str(c.body, "A workflow has an update for your team."),
            ctx
          ),
          caseId: str(ctx.caseId) || undefined,
        });
      }
      return {
        output: { notified: role.toLowerCase(), recipients: users.length },
      };
    },
  },

  // ── Communication: email / WhatsApp / webhook ──
  "action.email.send": {
    preview: (c) => ({
      dryRun: true,
      wouldEmail: str(c.to, "client"),
      subject: str(c.subject),
    }),
    execute: async (c, ctx) => {
      const to = interpolate(str(c.to, "client"), ctx);
      const subject = interpolate(
        str(c.subject, "A message from Citizen Lane"),
        ctx
      );
      const body = interpolate(str(c.body, ""), ctx);
      const targets: string[] = [];
      if (to === "client") {
        const cwc = await caseWithClient(ctx);
        if (cwc?.client.email) targets.push(cwc.client.email);
      } else if (to === "rm_team") {
        const rms = await db.user.findMany({
          where: { role: { in: ["RM", "SENIOR_RM"] }, status: "ACTIVE" },
          select: { email: true },
        });
        targets.push(...rms.map((r) => r.email));
      } else if (/.+@.+\..+/.test(to)) {
        targets.push(to);
      }
      if (targets.length === 0)
        return {
          output: {
            emailDelivered: false,
            emailChannel: "skipped",
            emailDetail: "no resolvable recipient",
          },
        };
      const results = await Promise.all(
        targets.map((t) => sendEmail({ to: t, subject, body }))
      );
      return {
        output: {
          emailDelivered: results.every((r) => r.delivered),
          emailChannel: [...new Set(results.map((r) => r.channel))].join("+"),
          emailDetail: results.map((r) => r.detail).join("; "),
        },
      };
    },
  },
  "action.whatsapp.send": {
    preview: (c) => ({
      dryRun: true,
      wouldWhatsapp: str(c.to, "client"),
      preview: str(c.message).slice(0, 60),
    }),
    execute: async (c, ctx) => {
      const to = interpolate(str(c.to, "client"), ctx);
      const message = interpolate(str(c.message, ""), ctx);
      let phone: string | undefined;
      if (to === "client") {
        const cwc = await caseWithClient(ctx);
        phone = cwc?.client.phone ?? undefined;
      } else {
        phone = to;
      }
      if (!phone)
        return {
          output: {
            whatsappDelivered: false,
            whatsappChannel: "skipped",
            whatsappDetail: "no phone number resolved",
          },
        };
      const res = await sendWhatsApp({ toPhone: phone, message });
      return {
        output: {
          whatsappDelivered: res.delivered,
          whatsappChannel: res.channel,
          whatsappDetail: res.detail,
        },
      };
    },
  },
  "action.http.webhook": {
    preview: (c) => ({
      dryRun: true,
      wouldCall: str(c.url),
      method: str(c.method, "POST"),
    }),
    execute: async (c, ctx, opts) => {
      const url = interpolate(str(c.url), ctx);
      // Abort-threading: an already-lapsed engine budget never sends.
      if (opts?.signal?.aborted)
        return { output: { httpOk: false, httpDetail: "aborted before send" } };
      const method = str(c.method, "POST").toUpperCase();
      if (!/^https?:\/\//.test(url))
        return { output: { httpOk: false, httpDetail: "invalid URL" } };
      // SSRF guard — resolve the host and refuse private/loopback addresses,
      // matching the webhook dispatcher's assertPublicWebhookTarget. A trusted
      // same-process relay (localhost) is exempt so internal calls still work.
      if (!isTrustedRelayUrl(url)) {
        const guard = await assertPublicWebhookTarget(url);
        if (!guard.ok)
          return { output: { httpOk: false, httpDetail: guard.error } };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      // Link the engine budget: a node TIMEOUT aborts this send mid-flight.
      const outer = opts?.signal;
      const onOuterAbort = () => controller.abort();
      outer?.addEventListener("abort", onOuterAbort, { once: true });
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        let body: string | undefined;
        if (method === "POST") {
          const template = str(c.bodyTemplate, "{}");
          body = interpolate(template, ctx);
          // PII boundary — anything leaving the deployment to a host we do not
          // own is scrubbed first (a same-process relay is exempt). JSON
          // payloads are parsed, scrubbed structurally and re-serialised so the
          // receiver still gets valid JSON; a non-JSON body gets the free-text
          // value pass so embedded emails / numbers are masked in place.
          if (!isTrustedRelayUrl(url)) {
            try {
              body = JSON.stringify(scrubPII(JSON.parse(body)));
            } catch {
              body = scrubString(body);
            }
          }
        }
        const res = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        const text = (await res.text().catch(() => "")).slice(0, 300);
        return {
          output: { httpStatus: res.status, httpOk: res.ok, httpPreview: text },
        };
      } catch (err) {
        return {
          output: {
            httpOk: false,
            httpDetail: err instanceof Error ? err.message : "webhook failed",
          },
        };
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuterAbort);
      }
    },
  },

  // ── CRM ──
  "action.case.transition": {
    preview: (c) => ({
      dryRun: true,
      wouldTransitionTo: str(c.status, "IN_PROGRESS"),
    }),
    execute: async (c, ctx) => {
      const caseId = str(ctx.caseId) || undefined;
      const to = str(c.status);
      if (!caseId || !to)
        return {
          output: {
            transitioned: false,
            reason: "no case in run context or no target status",
          },
        };
      // Lazy import — keeps executors decoupled from the case service (and
      // breaks the service → hub → engine → executors static cycle).
      const { transitionCase } = await import("@/lib/services/case-service");
      try {
        const updated = await transitionCase({
          caseId,
          to,
          command: "workflow.node",
          actorLabel: `workflow:${str(ctx.workflowName, "automation")}`,
          reason: str(c.reason, "Advanced by workflow"),
          hubDepth:
            typeof ctx.__hubDepth === "number" ? (ctx.__hubDepth as number) : 1,
          correlationId: str(ctx.correlationId) || undefined,
        });
        return { output: { transitioned: true, status: updated.status } };
      } catch (err) {
        // Illegal transition / state conflict — recorded in the run, never thrown.
        return {
          output: {
            transitioned: false,
            status: to,
            reason: err instanceof Error ? err.message : "transition failed",
          },
        };
      }
    },
  },
  "action.create.request": {
    preview: (c) => ({
      dryRun: true,
      wouldCreate: str(c.title, "Document request"),
    }),
    execute: async (c, ctx) => {
      const caseId = str(ctx.caseId) || undefined;
      if (!caseId)
        return {
          output: {
            skipped: true,
            reason: "create.request requires a case in run context",
          },
        };
      const req = await db.documentRequest.create({
        data: {
          caseId,
          docType: str(c.docType, "OTHER"),
          title: str(c.title, "Document request"),
          instructions: str(
            c.instructions,
            "Please upload the requested document."
          ),
          dueDate: c.dueDays
            ? new Date(Date.now() + num(c.dueDays, 7) * 86_400_000)
            : null,
          createdBy: "workflow",
          flexible: Boolean(c.flexible),
        },
      });
      return { output: { requestId: req.id } };
    },
  },

  // ── Approval ──
  "approval.human.gate": {
    preview: (c) => ({ dryRun: true, wouldPauseFor: str(c.role, "RM") }),
    execute: async (c) => ({
      output: { awaiting: str(c.role, "RM") },
      waitForApproval: true,
    }),
  },

  // ── AI ──
  "action.ai.compose": {
    preview: () => ({
      dryRun: true,
      wouldCompose: true,
      provider: "local-model",
    }),
    execute: async (c, ctx) => {
      const outputField = str(c.outputField, "aiText");
      const { aiChat } = await import("@/lib/ai/providers");
      const contextHint = c.inputField ? str(ctx[str(c.inputField)]) : "";
      const result = await aiChat(
        [
          {
            role: "system",
            content:
              "You are Citizen Lane's concierge copywriter. Write refined, warm, concise text for a private-client immigration atelier. No markdown.",
          },
          {
            role: "user",
            content: contextHint
              ? `${str(c.instruction)}\n\nContext: ${contextHint.slice(0, 500)}`
              : str(c.instruction),
          },
        ],
        { timeoutMs: 30_000 }
      );
      const text = result?.text?.trim() ?? "";
      // There is no server model endpoint — the built-in AI runs in the browser
      // only (@/lib/ai/providers always returns null). This used to emit an
      // EMPTY string and let the node succeed, so a "compose a welcome" flow
      // emailed the applicant blank copy while the run looked green. Fail the
      // node instead: a missing model must never silently become empty text.
      if (!text) {
        throw new Error(
          "AI text generation is unavailable on the server (the built-in AI runs in the browser only)"
        );
      }
      return {
        output: {
          [outputField]: text,
          aiProvider: result?.provider ?? "local-model",
        } as RunContext,
      };
    },
  },

  // ── Compliance ──
  "action.audit.export": {
    preview: () => ({ dryRun: true, wouldRecord: true }),
    // The node promises "Write a PII-safe entry into the audit export stream".
    // It previously only counted existing rows and returned a "capped at 500
    // rows" CSV claim, so a governance flow reported success while recording
    // nothing. Write the entry, then report the ledger's real size.
    execute: async (c, ctx) => {
      await audit({
        actorLabel: "workflow",
        action: "audit.export.recorded",
        target: str(ctx.caseId, "workflow"),
        after: {
          note: str(c.note, "Workflow audit entry"),
          caseId: str(ctx.caseId) || null,
        },
      });
      const auditRows = await db.auditEvent.count();
      return { output: { auditRows, recorded: true } };
    },
  },

  // ── DHL Express (MyDHL API) ──
  "action.dhl.dispatch": {
    preview: (c) => ({
      dryRun: true,
      wouldDispatch: true,
      destination: str(c.destination),
      pieces: num(c.pieces, 1),
      product: str(c.product),
    }),
    execute: async (c, ctx) => {
      const caseId = str(ctx.caseId);
      const caseRef =
        str(ctx.caseReference) || str(ctx.reference) || str(c.caseRef);
      const destination = interpolate(str(c.destination), ctx);
      const pieces = num(c.pieces, 1);
      const weightKg = num(c.weightKg, 0.5);
      const dimensions = c.dimensions
        ? JSON.parse(str(c.dimensions))
        : { length: 30, width: 21, height: 2 };

      if (!caseId || !caseRef || !destination) {
        return {
          output: {
            dispatched: false,
            reason: "missing caseId, caseRef or destination",
          },
        };
      }

      const shipment = await createShipment({
        caseRef,
        destination,
        documentRefs: str(c.documentRefs, "").split(",").filter(Boolean),
        product: str(c.product) || undefined,
        pieces: Array.from({ length: pieces }, () => ({
          weightKg,
          dimensionsCm: dimensions,
          description: str(c.description, "Immigration documents"),
        })),
      });

      // Persist dispatch record
      const dispatch = await db.dispatch.create({
        data: {
          caseId,
          carrier: "DHL",
          trackingId: shipment.trackingId,
          destination,
          status: "DISPATCHED",
          documentRefs: JSON.stringify(
            str(c.documentRefs, "").split(",").filter(Boolean)
          ),
          dispatchedAt: new Date(),
        },
      });

      // Schedule follow-up (6 weeks default)
      const followUpWeeks = num(c.followUpWeeks, 6);
      const dueDate = new Date(Date.now() + followUpWeeks * 7 * 86_400_000);
      await db.followUp.create({
        data: {
          dispatchId: dispatch.id,
          caseId,
          dueDate,
          note: str(
            c.followUpNote,
            `Follow up with authority after ${followUpWeeks} weeks`
          ),
        },
      });

      // Emit event for hub fan-out. Lazy import — a static import would close
      // the executors → event-hub → workflow-engine → nodes → executors cycle.
      const { emitCaseEvent } = await import("@/lib/services/event-hub");
      await emitCaseEvent("dispatch.created", {
        caseId,
        actorLabel: `workflow:${str(ctx.workflowName, "automation")}`,
        meta: {
          dispatchId: dispatch.id,
          trackingId: shipment.trackingId,
          destination,
          carrier: "DHL",
        },
        dedupeKey: dispatch.id,
      }).catch(() => undefined);

      return {
        output: {
          dispatched: true,
          sandbox: shipment.sandbox === true,
          trackingId: shipment.trackingId,
          labelUrl: shipment.labelUrl,
          labelPdfBase64: shipment.labelPdfBase64,
          dispatchId: dispatch.id,
        },
      };
    },
  },

  "action.dhl.track": {
    preview: (c) => ({
      dryRun: true,
      wouldTrack: true,
      trackingId: str(c.trackingId),
    }),
    execute: async (c, ctx) => {
      const trackingId = interpolate(
        str(c.trackingId) || str(ctx.trackingId),
        ctx
      );
      if (!trackingId) {
        return {
          output: {
            tracked: false,
            reason: "no trackingId in config or context",
          },
        };
      }

      // Look up dispatchedAt for sandbox fallback
      const dispatch = await db.dispatch.findUnique({
        where: { trackingId },
        select: { dispatchedAt: true },
      });
      const events = await getTrackingEvents(
        trackingId,
        dispatch?.dispatchedAt ?? undefined
      );
      const latest = events[events.length - 1];

      return {
        output: {
          tracked: true,
          trackingId,
          events: events.map((e) => ({
            status: e.status,
            at: e.at.toISOString(),
            note: e.note,
            location: e.location,
          })),
          latestStatus: latest?.status,
          latestAt: latest?.at.toISOString(),
        },
      };
    },
  },

  "action.dhl.label": {
    preview: (c) => ({
      dryRun: true,
      wouldFetchLabel: true,
      trackingId: str(c.trackingId),
    }),
    execute: async (c, ctx) => {
      const trackingId = interpolate(
        str(c.trackingId) || str(ctx.trackingId),
        ctx
      );
      if (!trackingId) {
        return {
          output: {
            fetched: false,
            reason: "no trackingId in config or context",
          },
        };
      }

      // Fetch label from DHL API
      const label = await getLabel(trackingId);
      if (label) {
        return {
          output: {
            fetched: true,
            trackingId,
            labelUrl: label.labelUrl,
            labelPdfBase64: label.labelPdfBase64,
          },
        };
      }

      // Fallback to context if DHL returns nothing
      const labelUrl = str(ctx.labelUrl);
      const labelPdfBase64 = str(ctx.labelPdfBase64);
      return {
        output: {
          fetched: !!(labelUrl || labelPdfBase64),
          trackingId,
          labelUrl: labelUrl || undefined,
          labelPdfBase64: labelPdfBase64 || undefined,
        },
      };
    },
  },
};
