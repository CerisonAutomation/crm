/**
 * Workflow runtime — versioned graph execution with durable run/node records.
 * Semantics: sequential edge traversal, at-least-once via recorded attempts,
 * human approval pauses the run (WAITING_APPROVAL) and resumes only on an
 * authorised decision recorded in audit. Replay-safe: nodes are idempotent by key.
 */
import { db } from "@/lib/db";
import { DomainError, redactionSafe } from "@/lib/domain/engine-utils";
import { getExecutor } from "@/lib/nodes";
import { audit } from "@/lib/api-helpers";
import { emitAutomationEvent } from "@/lib/adapters/automation";
import { validateGraph, MAX_DEPTH } from "./graph-validation";
import { claimStepKey } from "@/lib/idempotency";
import { nodeContractFor } from "@/lib/nodes/catalog";
import { failureCategory, withNodeTimeout } from "@/lib/automation/scheduler";
import { supportsInteractiveTx } from "@/lib/db-adapter";
import { generateResumeToken } from "@/lib/automation/waitpoints";

export type WfNode = {
  key: string;
  pieceKey: string;
  name: string;
  config: Record<string, unknown>;
};
export type WfEdge = { from: string; to: string; label?: string };

// ───────────────────────── validation ─────────────────────────
// Graph validation is a pure module (unit-testable, DB-free); re-exported here
// so existing `import { validateGraph } from "…/workflow-engine"` keeps working.
export { validateGraph };

// ───────────────────────── execution ─────────────────────────

type RunContext = Record<string, unknown>;

/** True when the run is a studio test run — side-effecting pieces become previews. */
function isDryRun(ctx: RunContext): boolean {
  return ctx.__dryRun === true;
}

/**
 * R3 — idempotent step effects keyed by (runId, nodeKey).
 *
 * No schema migration was needed: WorkflowNodeRun has no (runId, nodeKey)
 * unique constraint, so the terminal-outcome replay below converges duplicate
 * deliveries on the first execution at the application layer, while the
 * per-step IdempotencyKey reservation (claimStepKey) serialises two
 * deliveries racing each other. FAILED outcomes replay too — a duplicate
 * delivery of an already-failed step returns the recorded failure instead of
 * re-running its side effects.
 */
const TERMINAL_NODE_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "WAITING_APPROVAL",
  "WAITING_WORKFLOW",
  "SKIPPED",
];

async function findTerminalNodeRun(runId: string, nodeKey: string) {
  return db.workflowNodeRun.findFirst({
    where: { runId, nodeKey, status: { in: TERMINAL_NODE_STATUSES } },
    orderBy: { id: "desc" },
  });
}

/**
 * Bounded wait for a step owner's recorded outcome (at-most-once steps only).
 * Polls the terminal-outcome lookup briefly; returns the replayed outcome or
 * null when nothing lands in budget. Never executes anything.
 */
async function awaitStepOutcome(
  runId: string,
  nodeKey: string,
  attempts = 20,
  delayMs = 250
): Promise<NodeOutcome | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const row = await findTerminalNodeRun(runId, nodeKey);
    if (row) return replayNodeRun(row);
  }
  return null;
}

type NodeOutcome = {
  output: RunContext;
  waitForApproval?: boolean;
  waitForWorkflow?: { workflowId: string; runId?: string };
  failed?: string;
};

/**
 * Replay a recorded terminal outcome without re-executing the node.
 * Returns null when the row cannot be replayed safely (legacy
 * WAITING_WORKFLOW rows recorded before the wait target was persisted, or
 * SKIPPED/unknown statuses) — the caller then executes normally.
 */
function replayNodeRun(prior: {
  status: string;
  outputPreview: string;
  error: string | null;
}): NodeOutcome | null {
  let stored: Record<string, unknown> = {};
  try {
    stored =
      (JSON.parse(prior.outputPreview || "{}") as Record<string, unknown>) ??
      {};
  } catch {
    stored = {};
  }
  // The wait-target marker is engine bookkeeping, never run context.
  const { __waitForWorkflow, ...output } = stored as Record<string, unknown> & {
    __waitForWorkflow?: { workflowId?: string; runId?: string };
  };
  switch (prior.status) {
    case "SUCCEEDED":
      return { output: output as RunContext };
    case "FAILED":
      return {
        output: output as RunContext,
        failed: prior.error ?? "node failed",
      };
    case "WAITING_APPROVAL":
      return { output: output as RunContext, waitForApproval: true };
    case "WAITING_WORKFLOW": {
      const target = __waitForWorkflow;
      if (target?.workflowId) {
        return {
          output: output as RunContext,
          waitForWorkflow: {
            workflowId: target.workflowId,
            runId: target.runId,
          },
        };
      }
      return null;
    }
    default:
      return null;
  }
}
// Failure categorisation: prefix node errors with the DLQ triage chip so an
// operator scans a category instead of reading free text. Applied at write
// time so replays carry the same label.
function categorizedError(err: unknown): string {
  const message =
    err instanceof Error ? err.message : String(err ?? "node failed");
  const category = failureCategory(err);
  return category === "UNKNOWN" ? message : `[${category}] ${message}`;
}

/**
 * Persist a durable waitpoint for a paused run (Trigger.dev waitpoint pattern).
 * The resume token + redacted context snapshot let the run resume exactly
 * once after a crash. Best-effort: never breaks the pause it annotates.
 */
async function persistWaitpoint(input: {
  runId: string;
  nodeRunId: string;
  kind: "APPROVAL" | "EVENT";
  eventKind?: string;
  contextSnapshot: RunContext;
}): Promise<void> {
  try {
    await db.waitpoint.create({
      data: {
        runId: input.runId,
        nodeRunId: input.nodeRunId,
        kind: input.kind,
        resumeToken: generateResumeToken(),
        // Pauses are human/event-paced, not lease-paced: 30 days, reaped after.
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        eventKind: input.eventKind,
        contextSnapshot: JSON.stringify(redactionSafe(input.contextSnapshot)),
        status: "WAITING",
      },
    });
  } catch (e) {
    console.error(
      `[workflow-engine] waitpoint persist failed for run ${input.runId}`,
      e
    );
  }
}

/**
 * Mark a paused step's waitpoints resumed (exactly-once bookkeeping for the
 * durable wake). Best-effort — the run transition itself is authoritative.
 */
async function markWaitpointsResumed(
  runId: string,
  nodeRunId: string,
  resumedBy: string
): Promise<void> {
  await db.waitpoint
    .updateMany({
      where: { runId, nodeRunId, status: "WAITING" },
      data: { status: "RESUMED", resumedBy, resumedAt: new Date() },
    })
    .catch(() => undefined);
}

async function executeNode(
  node: WfNode,
  ctx: RunContext,
  runId: string,
  actorCtx: { actorLabel?: string }
): Promise<{
  output: RunContext;
  waitForApproval?: boolean;
  waitForWorkflow?: { workflowId: string; runId?: string };
  failed?: string;
}> {
  // R3 replay: a step that already reached a terminal outcome is never
  // re-executed — the duplicate delivery converges on the recorded result.
  const prior = await findTerminalNodeRun(runId, node.key);
  if (prior) {
    const replayed = replayNodeRun(prior);
    if (replayed) return replayed;
  }
  // Execution semantics (contract.execution): at-least-once steps converge
  // via replay-or-proceed; at-most-once steps (one-shot sends, bookings)
  // NEVER execute blind — a loser or an orphan-takeover waits briefly for
  // the owner's recorded outcome and fails loudly instead of risking a
  // duplicate side effect. Replay itself never re-executes under either
  // semantics, so converging on a recorded outcome is always safe.
  const semantics = nodeContractFor(node.pieceKey).execution;
  const claim = await claimStepKey(runId, node.key);
  if (!claim.won) {
    const raced = await findTerminalNodeRun(runId, node.key);
    if (raced) {
      const replayed = replayNodeRun(raced);
      if (replayed) return replayed;
    }
    if (semantics === "at-most-once") {
      const waited = await awaitStepOutcome(runId, node.key);
      if (waited) return waited;
      return {
        output: {},
        failed: `Step ${node.key} is owned by another execution (at-most-once)`,
      };
    }
  } else if (semantics === "at-most-once") {
    // Orphan take-over guard: a stale RUNNING row means a previous execution
    // may still hold the effect. Do not stack a second execution on it.
    const orphan = await db.workflowNodeRun.findFirst({
      where: { runId, nodeKey: node.key, status: "RUNNING" },
      select: { id: true },
    });
    if (orphan) {
      const waited = await awaitStepOutcome(runId, node.key);
      if (waited) return waited;
      return {
        output: {},
        failed: `Step ${node.key} has an in-flight execution (at-most-once)`,
      };
    }
  }
  const nodeRun = await db.workflowNodeRun.create({
    data: {
      runId,
      nodeKey: node.key,
      pieceKey: node.pieceKey,
      name: node.name,
      status: "RUNNING",
      inputPreview: JSON.stringify(redactionSafe(node.config ?? {})),
    },
  });

  try {
    let output: RunContext = {};
    let waitForApproval = false;
    let waitForWorkflow: { workflowId: string; runId?: string } | undefined;

    const executor = getExecutor(node.pieceKey);
    if (executor) {
      if (isDryRun(ctx) && !node.pieceKey.startsWith("trigger.")) {
        output = {
          ...(await executor.preview(node.config ?? {}, ctx)),
          __dryRun: true,
        };
      } else {
        // Activepieces-style contract: the node's timeout budget is the
        // catalog default narrowed by any executor override. A hung external
        // call (webhook, AI, DHL) fails TIMEOUT instead of pinning the run —
        // and the lease heartbeat keeps reclaim away while we wait.
        const contract = nodeContractFor(node.pieceKey);
        const budget = Math.min(
          contract.timeoutMs,
          executor.timeoutMs ?? Number.POSITIVE_INFINITY
        );
        // Abort-threading: the budget race aborts this controller, so
        // cancellable executors (fetch-backed) actually stop on TIMEOUT
        // instead of running on detached. Non-cancellable executors ignore
        // the signal; their late effects converge via the R3 step dedupe.
        const controller = new AbortController();
        const res = await withNodeTimeout(
          executor.execute(node.config ?? {}, ctx, {
            signal: controller.signal,
          }),
          node.pieceKey,
          budget,
          () => controller.abort()
        );
        output = res.output;
        waitForApproval = res.waitForApproval === true;
        waitForWorkflow = res.waitForWorkflow;
      }
    } else {
      // Unknown piece (older graph). This used to record the node as SUCCEEDED
      // with a "sandbox mode" note, so a graph containing a node nobody
      // implements reported a clean run and any downstream {{field}} silently
      // interpolated to an empty string. Fail it, naming the piece, so the gap
      // is visible instead of green.
      const reason = `[VALIDATION] No executor for piece "${node.pieceKey}"`;
      await db.workflowNodeRun.update({
        where: { id: nodeRun.id },
        data: {
          status: "FAILED",
          error: reason,
          attempts: { increment: 1 },
          outputPreview: JSON.stringify({ note: reason }),
          finishedAt: new Date(),
        },
      });
      return { output: {}, failed: reason };
    }

    // Determine the final status based on what the executor requested
    let finalStatus: "SUCCEEDED" | "WAITING_APPROVAL" | "WAITING_WORKFLOW" =
      "SUCCEEDED";
    if (waitForApproval) {
      finalStatus = "WAITING_APPROVAL";
    } else if (waitForWorkflow) {
      finalStatus = "WAITING_WORKFLOW";
    }

    // The wait target is persisted alongside the output so a duplicate
    // delivery can replay the pause exactly (R3); replay strips this
    // engine-bookkeeping key before merging context.
    const storedOutput = waitForWorkflow
      ? { ...output, __waitForWorkflow: waitForWorkflow }
      : output;
    await db.workflowNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: finalStatus,
        outputPreview: JSON.stringify(redactionSafe(storedOutput)),
        finishedAt: new Date(),
      },
    });

    // Durable wake (Trigger.dev waitpoint pattern): a paused run persists a
    // resume token + context snapshot so it survives a worker crash and
    // resumes exactly once. Best-effort — the pause stands without it.
    if (
      finalStatus === "WAITING_APPROVAL" ||
      finalStatus === "WAITING_WORKFLOW"
    ) {
      await persistWaitpoint({
        runId,
        nodeRunId: nodeRun.id,
        kind: finalStatus === "WAITING_APPROVAL" ? "APPROVAL" : "EVENT",
        eventKind: waitForWorkflow
          ? `workflow.completed:${waitForWorkflow.workflowId}`
          : undefined,
        contextSnapshot: ctx,
      });
    }

    // If this is a wait.workflow node, check if the target has already completed
    if (waitForWorkflow) {
      const alreadyCompleted = await checkAndResumeIfCompleted(
        nodeRun.id,
        runId,
        waitForWorkflow.workflowId,
        waitForWorkflow.runId,
        actorCtx.actorLabel
      );
      if (alreadyCompleted) {
        return { output, waitForWorkflow: undefined }; // Already resumed, don't pause
      }
    }

    return { output, waitForApproval, waitForWorkflow };
  } catch (err) {
    // Categorized (TIMEOUT when the budget raced first) + attempt-counted so
    // the run history shows duration (startedAt→finishedAt) and triage class.
    const message = categorizedError(err);
    await db.workflowNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: "FAILED",
        error: message,
        attempts: { increment: 1 },
        finishedAt: new Date(),
      },
    });
    return { output: {}, failed: message };
  }
}

/**
 * Check if the target workflow run has already completed, and if so, resume immediately.
 * Returns true if the run was already resumed.
 */
async function checkAndResumeIfCompleted(
  nodeRunId: string,
  runId: string,
  targetWorkflowId: string,
  targetRunId: string | undefined,
  actorLabel?: string
): Promise<boolean> {
  try {
    // Validate the target workflow exists
    const targetWorkflow = await db.workflow.findUnique({
      where: { id: targetWorkflowId },
      select: { id: true },
    });
    if (!targetWorkflow) {
      // Workflow doesn't exist — fail the wait node
      await db.workflowNodeRun.update({
        where: { id: nodeRunId },
        data: {
          status: "FAILED",
          error: `Target workflow ${targetWorkflowId} does not exist`,
          finishedAt: new Date(),
        },
      });
      const run = await db.workflowRun.findUnique({ where: { id: runId } });
      if (run) {
        await db.workflowRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            error: `Wait failed: target workflow ${targetWorkflowId} does not exist`,
            finishedAt: new Date(),
          },
        });
      }
      return true; // Handled (failed)
    }

    // Check if there's a completed run for this workflow
    const completedRun = await db.workflowRun.findFirst({
      where: {
        workflowId: targetWorkflowId,
        status: "SUCCEEDED",
        ...(targetRunId ? { id: targetRunId } : {}),
      },
      orderBy: { finishedAt: "desc" },
      select: { id: true },
    });

    if (completedRun) {
      // Target already completed — resume immediately
      await resumeWaitNode(
        nodeRunId,
        runId,
        targetWorkflowId,
        completedRun.id,
        actorLabel
      );
      return true;
    }

    return false;
  } catch (err) {
    console.error(
      `[workflow-engine] failed to check completed runs for wait node`,
      err
    );
    return false;
  }
}

/**
 * Resume a wait node atomically. Returns true if this call won the race.
 */
async function resumeWaitNode(
  nodeRunId: string,
  runId: string,
  completedWorkflowId: string,
  completedRunId: string,
  actorLabel?: string
): Promise<boolean> {
  try {
    // Atomically claim the node — only proceed if we're the first to claim it
    const claimResult = await db.workflowNodeRun.updateMany({
      where: { id: nodeRunId, status: "WAITING_WORKFLOW" },
      data: {
        status: "SUCCEEDED",
        outputPreview: JSON.stringify({
          waitedFor: completedWorkflowId,
          completedRunId,
          resumed: true,
        }),
        finishedAt: new Date(),
      },
    });

    if (claimResult.count === 0) {
      // Someone else already claimed this node
      return false;
    }
    // Durable wake bookkeeping: the waitpoint created at pause time is now consumed.
    await markWaitpointsResumed(
      runId,
      nodeRunId,
      actorLabel ?? "workflow-resume"
    );

    // Get the run and version
    const run = await db.workflowRun.findUnique({
      where: { id: runId },
      include: { workflow: { select: { id: true, currentVersion: true } } },
    });
    if (!run || run.status !== "WAITING_WORKFLOW") return false;

    const version = await db.workflowVersion.findUnique({
      where: {
        workflowId_version: {
          workflowId: run.workflowId,
          version: run.version,
        },
      },
    });
    if (!version) return false;

    // Check if there's a next node to execute
    const nodeRun = await db.workflowNodeRun.findUnique({
      where: { id: nodeRunId },
    });
    if (!nodeRun) return false;

    const nextNodeKey = nextNodeAfter(version.edges, nodeRun.nodeKey);

    // Update run status and merge context
    await db.workflowRun.update({
      where: { id: runId },
      data: { status: "RUNNING" },
    });

    // Merge the wait node's output into the context
    const ctx = JSON.parse(run.context || "{}");
    const mergedCtx = {
      ...ctx,
      waitedFor: completedWorkflowId,
      completedRunId,
    };

    if (nextNodeKey) {
      // Resume from the next node
      await executeFromNode(
        runId,
        version.nodes,
        version.edges,
        mergedCtx,
        actorLabel ?? "workflow-resume",
        nextNodeKey,
        run.workflowId
      );
    } else {
      // Terminal wait node — mark the run as succeeded
      await db.workflowRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          context: JSON.stringify(redactionSafe(mergedCtx)),
        },
      });
      await audit({ action: "workflow.run.succeeded", target: runId });
      if (run.workflowId) {
        void emitAutomationEvent(
          "workflow.run.completed",
          { workflowId: run.workflowId, status: "SUCCEEDED" },
          { correlationId: runId, actor: actorLabel }
        );
      }
    }

    return true;
  } catch (err) {
    console.error(
      `[workflow-engine] failed to resume wait node ${nodeRunId}`,
      err
    );
    return false;
  }
}

/** Execute a published workflow version for a case/submission. */
export async function startRun(opts: {
  workflowId: string;
  caseId?: string;
  pageSubmissionId?: string;
  trigger: string;
  context?: RunContext;
  actorLabel?: string;
  correlationId?: string;
  /** Event-trigger dedupe — duplicate events return the original run (consolidated 2026-10-06, citizenlane). */
  dedupeKey?: string;
}) {
  const wf = await db.workflow.findUnique({ where: { id: opts.workflowId } });
  if (!wf) throw new DomainError("Workflow not found", 404);
  if (wf.disabled) throw new DomainError("Workflow is disabled", 409);
  if (wf.status !== "PUBLISHED" || !wf.currentVersion) {
    throw new DomainError("Workflow has no published version", 409);
  }
  const version = await db.workflowVersion.findUnique({
    where: {
      workflowId_version: { workflowId: wf.id, version: wf.currentVersion },
    },
  });
  if (!version) throw new DomainError("Published version missing", 500);

  // Run-start idempotency: the same trigger firing twice starts ONE run.
  let run;
  if (opts.dedupeKey) {
    const key = `run:${wf.id}:${opts.trigger}:${opts.caseId ?? "-"}:${
      opts.dedupeKey
    }`;
    try {
      await db.idempotencyKey.create({ data: { key, scope: "workflow-run" } });
    } catch {
      const k = await db.idempotencyKey.findUnique({ where: { key } });
      if (k?.resultRef) {
        const existing = await db.workflowRun.findUnique({
          where: { id: k.resultRef },
        });
        if (existing) return existing;
      }
      throw new DomainError("Duplicate run detected", 409);
    }
    // Run+key link in one tx (pg) so a crash between create and link cannot
    // orphan a claimed key: the duplicate delivery would 409 without ever
    // finding the original run. Neon-HTTP keeps the sequential path.
    const runData = {
      workflowId: wf.id,
      version: version.version,
      caseId: opts.caseId,
      pageSubmissionId: opts.pageSubmissionId,
      trigger: opts.trigger,
      status: "RUNNING",
      context: JSON.stringify(opts.context ?? {}),
    };
    if (supportsInteractiveTx()) {
      run = await db.$transaction(async (tx) => {
        const created = await tx.workflowRun.create({ data: runData });
        await tx.idempotencyKey.update({
          where: { key },
          data: { resultRef: created.id },
        });
        return created;
      });
    } else {
      run = await db.workflowRun.create({ data: runData });
      await db.idempotencyKey
        .update({ where: { key }, data: { resultRef: run.id } })
        .catch(() => undefined);
    }
  } else {
    run = await db.workflowRun.create({
      data: {
        workflowId: wf.id,
        version: version.version,
        caseId: opts.caseId,
        pageSubmissionId: opts.pageSubmissionId,
        trigger: opts.trigger,
        status: "RUNNING",
        context: JSON.stringify(opts.context ?? {}),
      },
    });
  }

  // Fire-and-forget automation event — delivery failure never breaks the run.
  void emitAutomationEvent(
    "workflow.run.started",
    {
      workflowId: wf.id,
      workflow: wf.name,
      version: version.version,
      trigger: opts.trigger,
    },
    {
      caseId: opts.caseId,
      actor: opts.actorLabel,
      correlationId: opts.correlationId ?? run.id,
    }
  );

  await executeFromNode(
    run.id,
    version.nodes,
    version.edges,
    { caseId: opts.caseId, ...opts.context },
    opts.actorLabel,
    undefined,
    wf.id
  );
  return run;
}

/**
 * Studio test run — executes the LATEST version (draft or published) end-to-end
 * in dry-run mode: no side effects, no PII, run recorded with trigger "manual.test".
 */
export async function startTestRun(workflowId: string, actorLabel?: string) {
  const wf = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!wf) throw new DomainError("Workflow not found", 404);
  const latest = await db.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { version: "desc" },
  });
  if (!latest)
    throw new DomainError("Nothing to test — save a draft first", 409);
  const validation = validateGraph(
    JSON.parse(latest.nodes),
    JSON.parse(latest.edges)
  );
  if (!validation.ok)
    throw new DomainError(
      `Graph invalid: ${validation.errors.join("; ")}`,
      422
    );

  const run = await db.workflowRun.create({
    data: {
      workflowId: wf.id,
      version: latest.version,
      trigger: "manual.test",
      status: "RUNNING",
      context: JSON.stringify({ __dryRun: true }),
    },
  });
  void emitAutomationEvent(
    "workflow.run.started",
    {
      workflowId: wf.id,
      workflow: wf.name,
      version: latest.version,
      trigger: "manual.test",
      dryRun: true,
    },
    { actor: actorLabel, correlationId: run.id }
  );
  await executeFromNode(
    run.id,
    latest.nodes,
    latest.edges,
    { __dryRun: true },
    actorLabel,
    undefined,
    wf.id
  );
  return run;
}

async function executeFromNode(
  runId: string,
  nodesJson: string,
  edgesJson: string,
  ctx: RunContext,
  actorLabel?: string,
  startNodeKey?: string,
  workflowId?: string
) {
  const nodes: WfNode[] = JSON.parse(nodesJson);
  const edges: WfEdge[] = JSON.parse(edgesJson);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edgesFrom = (k: string) => edges.filter((e) => e.from === k);

  let current =
    startNodeKey ?? nodes.find((n) => n.pieceKey.startsWith("trigger."))?.key;
  let depth = 0;
  let context = { ...ctx };

  while (current && depth < MAX_DEPTH) {
    const node = byKey.get(current);
    if (!node) break;

    const result = await executeNode(node, context, runId, { actorLabel });
    context = { ...context, ...result.output };

    if (result.failed) {
      await db.workflowRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          error: result.failed,
          attempts: { increment: 1 },
          finishedAt: new Date(),
        },
      });
      await audit({
        action: "workflow.run.failed",
        target: runId,
        reason: result.failed,
      });
      if (workflowId) {
        void emitAutomationEvent(
          "workflow.run.completed",
          { workflowId, status: "FAILED", error: result.failed },
          { correlationId: runId, actor: actorLabel }
        );
      }
      return;
    }
    if (result.waitForApproval) {
      await db.workflowRun.update({
        where: { id: runId },
        data: { status: "WAITING_APPROVAL" },
      });
      await audit({
        action: "workflow.run.waiting_approval",
        target: runId,
        after: { node: node.key },
      });
      return;
    }
    if (result.waitForWorkflow) {
      await db.workflowRun.update({
        where: { id: runId },
        data: { status: "WAITING_WORKFLOW" },
      });
      await audit({
        action: "workflow.run.waiting_workflow",
        target: runId,
        after: {
          node: node.key,
          workflowId: result.waitForWorkflow.workflowId,
        },
      });
      return;
    }

    const outEdges = edgesFrom(current);
    if (node.pieceKey === "condition.field.equals") {
      // Branch: follow the labeled edge for the outcome; with no labeled edges,
      // an unmatched condition skips the next node (the labeled "true" path).
      const matched = result.output.matched === true;
      const labeled = outEdges.find(
        (e) => e.label === (matched ? "true" : "false")
      );
      if (labeled) {
        current = labeled.to;
      } else if (!matched && outEdges[0]) {
        const skipped = outEdges[0].to;
        current = edgesFrom(skipped)[0]?.to;
        context = { ...context, __skippedNode: skipped };
      } else {
        current = outEdges[0]?.to;
      }
    } else {
      current = outEdges[0]?.to; // sequential traversal
    }
    depth++;
  }

  await db.workflowRun.update({
    where: { id: runId },
    data: {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      context: JSON.stringify(redactionSafe(context)),
    },
  });
  await audit({ action: "workflow.run.succeeded", target: runId });
  if (workflowId) {
    void emitAutomationEvent(
      "workflow.run.completed",
      { workflowId, status: "SUCCEEDED" },
      { correlationId: runId, actor: actorLabel }
    );
    // Resume any runs waiting for this workflow to complete
    await resumeRunsWaitingForWorkflow(workflowId, runId);
  }
}

/**
 * Resume runs that are waiting for a specific workflow run to complete.
 * Called when a workflow run succeeds — checks for wait.workflow nodes
 * targeting this workflow and resumes their parent runs.
 */
async function resumeRunsWaitingForWorkflow(
  completedWorkflowId: string,
  completedRunId: string
) {
  try {
    // Find all wait.workflow node runs that are waiting
    const waitingNodeRuns = await db.workflowNodeRun.findMany({
      where: {
        pieceKey: "wait.workflow",
        status: "WAITING_WORKFLOW",
      },
      include: {
        run: {
          include: {
            workflow: { select: { id: true, currentVersion: true } },
          },
        },
      },
    });

    for (const nodeRun of waitingNodeRuns) {
      // Check if this node is waiting for the completed workflow
      let output: Record<string, unknown> = {};
      try {
        output = JSON.parse(nodeRun.outputPreview || "{}");
      } catch {
        continue;
      }

      const waitedFor = String(output.waitedFor || "");
      const specificRunId = output.completedRunId
        ? String(output.completedRunId)
        : null;

      // Match: waiting for this workflow (and optionally a specific run)
      if (waitedFor !== completedWorkflowId) continue;
      if (specificRunId && specificRunId !== completedRunId) continue;

      // Resume the parent run atomically
      await resumeWaitNode(
        nodeRun.id,
        nodeRun.runId,
        completedWorkflowId,
        completedRunId,
        "workflow-resume"
      );
    }
  } catch (err) {
    console.error(
      `[workflow-engine] failed to resume waiting runs for ${completedWorkflowId}`,
      err
    );
  }
}

/**
 * Resume a paused run after a human approval decision. `orgId` is the acting
 * approver's organisation — a run whose workflow belongs to another tenant is
 * refused (fail closed) so an approval can never cross organisational lines.
 */
export async function resumeRunAfterDecision(
  runId: string,
  nodeRunId: string,
  decision: "APPROVED" | "REJECTED",
  reason: string,
  approverId: string,
  approverLabel: string,
  orgId: string
) {
  const run = await db.workflowRun.findUnique({
    where: { id: runId },
    include: { workflow: { select: { orgId: true } } },
  });
  if (!run) throw new DomainError("Run not found", 404);
  if (run.workflow.orgId !== orgId) throw new DomainError("Forbidden", 403);
  if (run.status !== "WAITING_APPROVAL")
    throw new DomainError("Run is not waiting for approval", 409);
  const nodeRun = await db.workflowNodeRun.findUnique({
    where: { id: nodeRunId },
  });
  if (!nodeRun || nodeRun.runId !== runId)
    throw new DomainError("Node run not found", 404);

  // Exactly-once claim (copies the event path): the decision write itself is
  // conditional on the step still waiting AND undecided, so two concurrent
  // approvals converge — the loser matches zero rows and gets 409 instead of
  // overwriting the winner's decision.
  const claim = await db.workflowNodeRun.updateMany({
    where: {
      id: nodeRunId,
      status: "WAITING_APPROVAL",
      approvalDecision: null,
    },
    data: {
      status: decision === "APPROVED" ? "SUCCEEDED" : "FAILED",
      approvalDecision: decision,
      decisionReason: reason,
      approverId,
      finishedAt: new Date(),
      outputPreview: JSON.stringify(redactionSafe({ decision, reason })),
    },
  });
  if (claim.count === 0) throw new DomainError("Approval already decided", 409);
  await audit({
    action: `workflow.approval.${decision.toLowerCase()}`,
    target: runId,
    reason,
    actorId: approverId,
    actorLabel: approverLabel,
  });
  // Durable wake bookkeeping: consume the approval waitpoint created at pause time.
  await markWaitpointsResumed(runId, nodeRunId, approverLabel);

  if (decision === "REJECTED") {
    await db.workflowRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: `Rejected at ${nodeRun.nodeKey}: ${reason}`,
        finishedAt: new Date(),
      },
    });
    return;
  }

  const version = await db.workflowVersion.findUnique({
    where: {
      workflowId_version: { workflowId: run.workflowId, version: run.version },
    },
  });
  if (!version) throw new DomainError("Run version missing", 500);

  const nextNodeKey = nextNodeAfter(version.edges, nodeRun.nodeKey);

  if (nextNodeKey) {
    // Resume from the next node
    await db.workflowRun.update({
      where: { id: runId },
      data: { status: "RUNNING" },
    });
    const ctx = JSON.parse(run.context || "{}");
    await executeFromNode(
      runId,
      version.nodes,
      version.edges,
      ctx,
      approverLabel,
      nextNodeKey,
      run.workflowId
    );
  } else {
    // Terminal approval node — mark the run as succeeded
    await db.workflowRun.update({
      where: { id: runId },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
    await audit({ action: "workflow.run.succeeded", target: runId });
    void emitAutomationEvent(
      "workflow.run.completed",
      { workflowId: run.workflowId, status: "SUCCEEDED" },
      { correlationId: runId, actor: approverLabel }
    );
  }
}

/**
 * Resume a run paused on an EVENT/CALLBACK waitpoint after its token was
 * redeemed (waitpoint resume-by-token API). Mirrors the tail of resumeWaitNode
 * without a completing workflow: the waiting step is claimed exactly once,
 * the delivered payload merges into the run context, and the run continues
 * from the next node (or succeeds when the wait was terminal). Tenant-scoped
 * like resumeRunAfterDecision — a cross-org resume fails closed.
 */
export async function resumeRunAfterEventPoint(opts: {
  runId: string;
  nodeRunId: string;
  payload?: Record<string, unknown>;
  actorLabel?: string;
  orgId: string;
}): Promise<void> {
  const run = await db.workflowRun.findUnique({
    where: { id: opts.runId },
    include: { workflow: { select: { orgId: true } } },
  });
  if (!run) throw new DomainError("Run not found", 404);
  if (run.workflow.orgId !== opts.orgId)
    throw new DomainError("Forbidden", 403);
  if (run.status !== "WAITING_WORKFLOW")
    throw new DomainError("Run is not waiting for an event", 409);
  const nodeRun = await db.workflowNodeRun.findUnique({
    where: { id: opts.nodeRunId },
  });
  if (!nodeRun || nodeRun.runId !== opts.runId)
    throw new DomainError("Node run not found", 404);

  // Exactly-once claim on the waiting step — a duplicate resume loses here.
  const claim = await db.workflowNodeRun.updateMany({
    where: { id: opts.nodeRunId, status: "WAITING_WORKFLOW" },
    data: {
      status: "SUCCEEDED",
      outputPreview: JSON.stringify(redactionSafe(opts.payload ?? {})),
      finishedAt: new Date(),
    },
  });
  if (claim.count === 0) throw new DomainError("Wait already resumed", 409);
  await markWaitpointsResumed(
    opts.runId,
    opts.nodeRunId,
    opts.actorLabel ?? "event-resume"
  );

  const version = await db.workflowVersion.findUnique({
    where: {
      workflowId_version: { workflowId: run.workflowId, version: run.version },
    },
  });
  if (!version) throw new DomainError("Run version missing", 500);
  const nextNodeKey = nextNodeAfter(version.edges, nodeRun.nodeKey);
  const ctx = {
    ...(JSON.parse(run.context || "{}") as RunContext),
    ...(opts.payload ?? {}),
  };

  if (nextNodeKey) {
    await db.workflowRun.update({
      where: { id: opts.runId },
      data: { status: "RUNNING" },
    });
    await executeFromNode(
      opts.runId,
      version.nodes,
      version.edges,
      ctx,
      opts.actorLabel,
      nextNodeKey,
      run.workflowId
    );
  } else {
    await db.workflowRun.update({
      where: { id: opts.runId },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        context: JSON.stringify(redactionSafe(ctx)),
      },
    });
    await audit({ action: "workflow.run.succeeded", target: opts.runId });
    void emitAutomationEvent(
      "workflow.run.completed",
      { workflowId: run.workflowId, status: "SUCCEEDED" },
      { correlationId: opts.runId, actor: opts.actorLabel }
    );
  }
}
function nextNodeAfter(edgesJson: string, nodeKey: string): string | undefined {
  const edges: WfEdge[] = JSON.parse(edgesJson);
  return edges.filter((e) => e.from === nodeKey).map((e) => e.to)[0];
}

/** Test a single node with safe sample data — never production PII. */
export async function testNode(
  pieceKey: string,
  sampleInput: Record<string, unknown>
) {
  const executor = getExecutor(pieceKey);
  // Unknown piece: fail honestly (ok:false) like any other test failure —
  // reporting ok:true for a node nobody implements let graphs with dead
  // pieces test green and ship broken.
  if (!executor)
    return { ok: false, error: `No executor for piece "${pieceKey}"` };
  try {
    const output = await executor.preview(sampleInput, {});
    return { ok: true, output: { ...output, dryRun: true } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Return only workflows that actually subscribe to `pieceKey` and are
 * safe to start runs from. Unused, missing, or archived versions are skipped
 * here so `startRunsForTrigger` does not fire dead runs.
 */
export async function findSubscribedWorkflows(
  pieceKey: string,
  opts: { orgId?: string } = {}
): Promise<Map<string, { id: string; name: string; currentVersion: { id: number; nodes: unknown; edges: unknown } }>> {
  const wfs = await db.workflow.findMany({
    where: { status: "PUBLISHED", disabled: false, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    select: { id: true, name: true, currentVersion: true },
  });

  // One workflow may subscribe to several triggers; run it once per piece key.
  const uniq = new Map<string, { id: string; name: string; currentVersion: { id: number; nodes: unknown; edges: unknown } }>();
  for (const wf of wfs) {
    if (!uniq.has(wf.id)) uniq.set(wf.id, { id: wf.id, name: wf.name, currentVersion: { id: wf.currentVersion, nodes: undefined, edges: undefined } as any });
  }

  // Only keep workflows whose version actually subscribes to this piece key.
  // Get all workflow versions for these workflows
  const versioned = [...uniq.values()].filter((wf) => wf.currentVersion.id !== 0); // 0 = none
  if (versioned.length === 0) return new Map();

  const versionRows = await db.workflowVersion.findMany({
    where: { workflowId: { in: versioned.map((wf) => wf.id) }, version: { in: versioned.map((wf) => wf.currentVersion.id) } },
    select: { workflowId: true, version: true, nodes: true, edges: true },
  });

  const versionsByWorkflow = new Map<string, { nodes: string; edges: string }>();
  for (const vr of versionRows) {
    versionsByWorkflow.set(`${vr.workflowId}:v${vr.version}`, { nodes: vr.nodes, edges: vr.edges });
  }

  const filtered = new Map<string, { id: string; name: string; currentVersion: { id: number; nodes: unknown; edges: unknown } }>();
  for (const wf of uniq.values()) {
    const versionKey = `${wf.id}:v${wf.currentVersion.id}`;
    const versionData = versionsByWorkflow.get(versionKey);
    if (!versionData) continue;

    let nodes: Array<{ pieceKey: string }> = [];
    let edges: unknown;
    try {
      nodes = JSON.parse(versionData.nodes) as Array<{ pieceKey: string }>;
      edges = JSON.parse(versionData.edges);
    } catch {
      continue;
    }

    if (nodes.some((n) => n.pieceKey === pieceKey)) {
      filtered.set(wf.id, { id: wf.id, name: wf.name, currentVersion: { id: wf.currentVersion.id, nodes, edges } as any });
    }
  }

  return filtered;
}

/**
 * Fan a non-case trigger out to every PUBLISHED, non-disabled workflow that
 * subscribes to the given trigger pieceKey (consolidated 2026-10-06,
 * citizenlane). Case-event topics go through the event hub instead. Each run
 * gets the canonical run-start dedupeKey. Never throws.
 */
export async function startRunsForTrigger(
  pieceKey: string,
  opts: {
    trigger: string;
    caseId?: string;
    context?: RunContext;
    actorLabel?: string;
    correlationId?: string;
    dedupeKey?: string;
    /** Scope the fan-out to one organisation (multi-tenant safety). */
    orgId?: string;
  }
): Promise<Array<{ workflowId: string; runId: string }>> {
  const started: Array<{ workflowId: string; runId: string }> = [];
  try {
    const subscribed = await findSubscribedWorkflows(pieceKey, { orgId: opts.orgId });
    for (const [workflowId, { name, currentVersion }] of subscribed) {
      try {
        const run = await startRun({
          workflowId,
          caseId: opts.caseId,
          trigger: opts.trigger,
          context: opts.context,
          actorLabel: opts.actorLabel,
          correlationId: opts.correlationId,
          dedupeKey: opts.dedupeKey,
        });
        started.push({ workflowId, runId: run.id });
      } catch (err) {
        console.error(
          `[workflow-engine] trigger fan-out failed (${name} on ${pieceKey})`,
          err
        );
      }
    }
  } catch (err) {
    console.error(
      `[workflow-engine] trigger fan-out scan failed (${pieceKey})`,
      err
    );
  }
  return started;
}
