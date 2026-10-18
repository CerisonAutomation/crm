/**
 * In-app automation engine — the pure, Prisma-free core.
 *
 * Citizen Lane runs its own automation: every business event is fanned out to
 * the in-process workflow engine (`startRunsForTrigger`) which executes the
 * matching PUBLISHED workflow graphs on the app's own node executors.
 *
 * Everything here is deterministic and dependency-free so it can be unit-tested
 * without a database (the repo's testing convention: specs import only
 * Prisma-free modules).
 *
 * ── Fan-out ownership ──────────────────────────────────────────────────────
 * `emitCaseEvent` (src/lib/services/event-hub.ts) is the fan-out point for the
 * case lifecycle: it already starts matching workflows in-app, with a recursion
 * depth guard, before mirroring the event outward. Those topics are therefore
 * marked as hub-owned here so `emitAutomationEvent` does NOT start them a second
 * time. Events that bypass the hub (a public page submission, an MCP
 * `dispatch_event`, self-build completions) are fanned out in-app by
 * `emitAutomationEvent` itself — so automation is complete with or without
 * any external sink.
 */

/** Topics the case-event hub already fans out in-app (trigger.<topic> already started). */
export const HUB_OWNED_TOPICS: ReadonlySet<string> = new Set([
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
  "dispatch.created",
  "letter.issued",
  "message.received",
  "reminder.created",
  "reminder.due",
  "reminder.escalated",
  "document.expiring",
  "case.stale",
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "triage.changed",
]);

/**
 * The engine's own lifecycle topics. These describe a run rather than a business
 * fact; treating them as triggers would let a workflow start a workflow on its
 * own completion, so they are recorded and forwarded to signed webhooks but
 * never fanned out in-app.
 */
export const ENGINE_LIFECYCLE_TOPICS: ReadonlySet<string> = new Set([
  "workflow.run.started",
  "workflow.run.completed",
  "workflow.mirrored",
  "selfbuild.completed",
]);

/** The trigger-node pieceKey that a topic dispatches to (catalog: `trigger.*`). */
export function triggerPieceKeyFor(topic: string): string {
  return `trigger.${topic}`;
}

/**
 * Hub-owned topics whose RUN-STARTING additionally belongs to the automation
 * entry point (reminder bridge): the hub starts runs for its own emissions,
 * but queue-executed jobs, MCP dispatches and direct emits of these topics
 * bypass the hub — without this set their workflows would never start.
 */
export const REMINDER_RUN_TOPICS: ReadonlySet<string> = new Set([
  "reminder.due",
  "document.expiring",
  "case.stale",
]);

/**
 * True when `emitAutomationEvent` should start in-app runs for this topic.
 * Excluded: hub-owned topics mirrored from the hub (already started there —
 * starting again would double-execute workflows) and the engine's own
 * lifecycle topics (would allow run→event→run chains). The reminder bridge
 * is the deliberate exception: a NON-mirrored entry of those topics (queue
 * execution, MCP dispatch, direct emit) starts runs because no hub emission
 * precedes it.
 */
export function shouldFanOutInApp(
  topic: string,
  opts?: { mirrored?: boolean }
): boolean {
  if (ENGINE_LIFECYCLE_TOPICS.has(topic)) return false;
  if (HUB_OWNED_TOPICS.has(topic)) {
    return !opts?.mirrored && REMINDER_RUN_TOPICS.has(topic);
  }
  return true;
}

/**
 * True when `emitAutomationEvent` may start in-app runs for this event: the
 * topic must not be excluded AND the emitting organisation must be known. The
 * trigger lookup is organisation-scoped, so an event with no known org is failed
 * CLOSED rather than fanned out globally — an unscoped lookup would reach every
 * tenant's published workflows and run another org's automation.
 *
 * ponytail: multi-tenant safety: fail-closed — no org context means no fan-out.
 */
export function canFanOutInApp(
  topic: string,
  orgId?: string | null,
  opts?: { mirrored?: boolean }
): boolean {
  return (
    typeof orgId === "string" && orgId !== "" && shouldFanOutInApp(topic, opts)
  );
}

/** Shape of a fan-out outcome, recorded on the ledger for observability. */
export type InAppFanOut = {
  /** Topic dispatched to the in-app engine. */
  topic: string;
  /** Trigger pieceKey looked up. */
  pieceKey: string;
  /** True when the fan-out was skipped by design (hub-owned / lifecycle). */
  skipped: boolean;
  /** Runs actually started. */
  started: Array<{ workflowId: string; runId: string }>;
};

/** Human-readable one-liner for the ledger `delivery` field. */
export function describeFanOut(out: InAppFanOut): string {
  if (out.skipped) return `in-app: skipped (${out.topic} is handled elsewhere)`;
  if (out.started.length === 0)
    return `in-app: no published workflow subscribed to ${out.pieceKey}`;
  return `in-app: ${out.started.length} run(s) started`;
}
