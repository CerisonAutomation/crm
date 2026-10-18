/**
 * Durable automation queue — the database IS the queue.
 *
 * Modelled on Windmill (no broker: workers claim rows from a table under a
 * lock) and the Gastown scheduler (one dispatch step per heartbeat, governed by
 * a concurrency cap, with a global pause). This is what makes Citizen Lane's
 * automation run with no external scheduler, message broker, or workflow tool.
 *
 * Claim protocol (the correctness heart of the module):
 *   1. a candidate page is read (QUEUED, past its backoff gate);
 *   2. the candidates are promoted in ONE CONDITIONAL update (`where { id: { in
 *      ids }, status: "QUEUED" }`), so if two workers race for a row exactly one
 *      statement matches it — the loser simply claims fewer. This is the portable
 *      equivalent of Postgres' `SELECT … FOR UPDATE SKIP LOCKED`;
 *   3. the winner holds a LEASE. If its process dies, `reclaimStaleJobs` returns
 *      the job to the queue instead of losing it.
 *
 * Failure handling: an attempt is recorded, the job is re-queued after an
 * exponential backoff, and after `maxAttempts` it escalates to DEAD (a
 * dead-letter queue) — never silently dropped.
 */
import { db, withTenantContext, type TenantTx } from "@/lib/db";
import { isServerless } from "@/lib/deployment";
import { selectDbAdapterKind } from "@/lib/db-adapter";
import { getIntegration } from "@/lib/integrations";
import type { Prisma } from "@/generated/prisma/client";
import type {
  AutomationTopic,
  AutomationPayload,
} from "@/lib/adapters/automation";
import type { WorkerClass } from "@/lib/automation/scheduler";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT,
  backoffUntil,
  classesWithCapacity,
  concurrencyKeyFor,
  escalationSeverity,
  failureCategory,
  heartbeatIntervalMs,
  isLeaseExpired,
  leaseUntil,
  nextStatusOnFailure,
  noteSweeperRun,
  planDispatch,
  shouldRenewLease,
  sweepOverlapCountSinceBoot,
  workerClassFor,
  DEFAULT_LEASE_MS,
} from "@/lib/automation/scheduler";

/**
 * Phase-1b R2 tx-threading (ADR-002 P1): per-job DB units run inside
 * `withTenantContext(job.orgId)` — one short tx per unit (finish/close),
 * never one tx across external I/O. Interactive transactions exist only on
 * the pg driver; on Neon-HTTP every unit falls back to the current
 * sequential best-effort path instead of hard-throwing.
 *
 * Claim/reclaim sweeps stay on the global client by necessity: they span
 * organisations, and no single tenant context can see every row. (P1 sets no
 * FORCE RLS — the app connects as table owner — so the global path keeps
 * working while the per-job path hardens ahead of a restricted role.)
 */
type DbUnit = typeof db | TenantTx;

/** True only where $transaction exists (pg driver) — Neon-HTTP must never see one. */
function supportsInteractiveTx(): boolean {
  return selectDbAdapterKind(process.env as { DB_DRIVER?: string }) === "pg";
}

export type GovernorConfig = {
  maxConcurrent: number;
  batchSize: number;
  paused: boolean;
  /** Max concurrent RUNNING jobs per worker class (absent class = uncapped). */
  perClass: Partial<Record<WorkerClass, number>>;
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the dispatch governor from the DB (Admin → Integrations → "automation"),
 * falling back to the shipped defaults. Nothing here needs an env var.
 */
const WORKER_CLASSES: WorkerClass[] = ["OCR", "AI", "DHL", "NOTIFY", "DEFAULT"];

/** Parse per-class caps defensively: unknown classes and non-positive numbers are dropped (uncapped). */
function parsePerClass(raw: unknown): Partial<Record<WorkerClass, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<WorkerClass, number>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(WORKER_CLASSES as string[]).includes(k)) continue;
    const n = num(v, 0);
    if (n > 0) out[k as WorkerClass] = Math.floor(n);
  }
  return out;
}

async function readGovernor(): Promise<GovernorConfig> {
  const { active, config } = await getIntegration("automation").catch(() => ({
    active: false,
    config: {} as Record<string, unknown>,
  }));
  if (!active)
    return {
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      batchSize: DEFAULT_BATCH_SIZE,
      paused: false,
      perClass: {},
    };
  return {
    maxConcurrent: num(config.maxConcurrent, DEFAULT_MAX_CONCURRENT),
    batchSize: num(config.batchSize, DEFAULT_BATCH_SIZE),
    paused: config.paused === true || config.paused === "true",
    perClass: parsePerClass(config.perClass),
  };
}

// ───────────────────────────── enqueue ─────────────────────────────

export type EnqueueInput = {
  topic: AutomationTopic;
  payload: AutomationPayload;
  orgId?: string;
  correlationId?: string;
  maxAttempts?: number;
  /** Delay before the job becomes eligible (schedules a deferred run). */
  delayMs?: number;
  /**
   * Replay-safe enqueue: when set, the (topic, dedupeKey) reservation is
   * claimed first and a duplicate delivery returns the in-flight job instead
   * of enqueuing twice. The claim's recorded ref (the first job id) wins;
   * otherwise the in-flight job is found by correlationId.
   */
  dedupeKey?: string;
};

/**
 * Persist a job durably. Returns null when the write fails (never throws).
 *
 * With `dedupeKey` the enqueue is replay-safe: the (topic, dedupeKey)
 * reservation is claimed first (the table's uniqueness picks exactly one
 * winner) and a duplicate delivery returns the in-flight job instead of
 * enqueuing twice. Without it the behaviour is unchanged (always enqueue).
 */
export async function enqueueAutomationJob(input: EnqueueInput) {
  if (input.dedupeKey) {
    const { claimJobDedupeKey, jobDedupeKeyFor } = await import(
      "@/lib/automation/idempotency"
    );
    const { resolveIdempotencyKey } = await import("@/lib/idempotency");
    const key = jobDedupeKeyFor(input.topic, input.dedupeKey);
    const claim = await claimJobDedupeKey(input.topic, input.dedupeKey).catch(
      () => null
    );
    if (claim && !claim.won) {
      // Duplicate delivery — replay, never re-enqueue. The winner's recorded
      // job id wins; otherwise fall back to the live job for this correlation
      // (and heal the reservation so the next replay finds it directly).
      if (claim.existingRef) {
        const winner = await db.automationJob
          .findUnique({ where: { id: claim.existingRef } })
          .catch(() => null);
        if (winner) return winner;
      }
      if (input.correlationId) {
        const live = await db.automationJob
          .findFirst({
            where: {
              topic: input.topic,
              correlationId: input.correlationId,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            orderBy: { createdAt: "desc" },
          })
          .catch(() => null);
        if (live) {
          await resolveIdempotencyKey(key, live.id);
          return live;
        }
      }
      return null;
    }
  }
  const notBefore =
    input.delayMs && input.delayMs > 0
      ? new Date(Date.now() + input.delayMs)
      : new Date();
  const created = await db.automationJob
    .create({
      data: {
        topic: input.topic,
        payload: JSON.stringify(input.payload),
        orgId: input.orgId ?? null,
        status: "QUEUED",
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        notBefore,
        correlationId: input.correlationId ?? null,
        // Routing metadata is derived from the event, so it is always consistent
        // with the topic and never a second list to drift.
        concurrencyKey: concurrencyKeyFor({
          topic: input.topic,
          caseId: input.payload.caseId,
          orgId: input.orgId,
        }),
        workerClass: workerClassFor(input.topic),
      },
    })
    .catch(() => null);
  // Record the winner so duplicate deliveries replay this job directly.
  if (created && input.dedupeKey) {
    const { resolveIdempotencyKey } = await import("@/lib/idempotency");
    const { jobDedupeKeyFor: keyFor } = await import(
      "@/lib/automation/idempotency"
    );
    await resolveIdempotencyKey(
      keyFor(input.topic, input.dedupeKey),
      created.id
    );
  }
  return created;
}

// ───────────────────────────── claim / complete ─────────────────────────────

export type ClaimedJob = {
  id: string;
  topic: string;
  payload: string;
  orgId: string | null;
  attempts: number;
  maxAttempts: number;
};

/**
 * Atomically claim up to `limit` eligible jobs for `workerId`.
 * See the conditional-update note in the module header for why this is race-safe.
 *
 * Per-key serialisation: a candidate whose `concurrencyKey` already has a
 * RUNNING job is skipped, so two jobs on the same case (or org) never execute
 * concurrently. An attempt row is opened for each claimed job.
 */
/**
 * Atomically claim up to `limit` eligible jobs for `workerId`.
 * `onlyClasses` enforces the per-class governor INSIDE the claim: a class
 * without free capacity contributes no candidates, so a burst in one class
 * can never starve the others (null = every class, the pre-governor shape).
 * Legacy rows with a null workerClass ride along only when DEFAULT is allowed.
 */
async function claimAutomationJobs(
  workerId: string,
  limit: number,
  onlyClasses?: WorkerClass[] | null
): Promise<ClaimedJob[]> {
  if (limit <= 0) return [];
  if (onlyClasses && onlyClasses.length === 0) return [];
  const now = new Date();
  const classFilter =
    onlyClasses && onlyClasses.length > 0
      ? {
          OR: [
            { workerClass: { in: onlyClasses } },
            ...(onlyClasses.includes("DEFAULT") ? [{ workerClass: null }] : []),
          ],
        }
      : {};
  const candidates = await db.automationJob.findMany({
    where: { status: "QUEUED", notBefore: { lte: now }, ...classFilter },
    orderBy: { notBefore: "asc" },
    take: limit,
    select: { id: true, concurrencyKey: true },
  });
  if (candidates.length === 0) return [];

  // Which of the candidate keys are already busy (a RUNNING job holds them)?
  const keys = [
    ...new Set(
      candidates.map((c) => c.concurrencyKey).filter((k): k is string => !!k)
    ),
  ];
  const busyKeys = keys.length
    ? new Set(
        (
          await db.automationJob
            .findMany({
              where: { status: "RUNNING", concurrencyKey: { in: keys } },
              select: { concurrencyKey: true },
            })
            .catch(() => [])
        ).map((r) => r.concurrencyKey as string)
      )
    : new Set<string>();
  const eligible = candidates.filter(
    (c) => !c.concurrencyKey || !busyKeys.has(c.concurrencyKey)
  );
  if (eligible.length === 0) return [];
  const ids = eligible.map((c) => c.id);

  // One conditional statement promotes every candidate that is still QUEUED; a
  // row another worker took no longer matches `status: "QUEUED"` and is skipped.
  await db.automationJob.updateMany({
    where: { id: { in: ids }, status: "QUEUED" },
    data: {
      status: "RUNNING",
      claimedBy: workerId,
      claimedAt: now,
      leaseUntil: leaseUntil(now, DEFAULT_LEASE_MS),
    },
  });

  // A QUEUED row always has no owner, so this returns exactly the rows we just took.
  const claimed = await db.automationJob.findMany({
    where: { id: { in: ids }, claimedBy: workerId },
    select: {
      id: true,
      topic: true,
      payload: true,
      orgId: true,
      attempts: true,
      maxAttempts: true,
      concurrencyKey: true,
      claimedAt: true,
    },
  });

  // Post-claim key guard: the busyKeys pre-check races across workers — two
  // cycles can pass it simultaneously and claim the same key. A just-claimed
  // job whose key is ALSO held by an older RUNNING row is released (back to
  // QUEUED) instead of running concurrently. Older claim wins; ties favour
  // the existing holder so a release can never chase itself.
  const kept: typeof claimed = [];
  for (const job of claimed) {
    if (!job.concurrencyKey) {
      kept.push(job);
      continue;
    }
    const rival = await db.automationJob
      .findFirst({
        where: {
          status: "RUNNING",
          concurrencyKey: job.concurrencyKey,
          NOT: { id: job.id },
        },
        select: { claimedAt: true },
        orderBy: { claimedAt: "asc" },
      })
      .catch(() => null);
    const rivalOlder =
      !rival ||
      !rival.claimedAt ||
      !job.claimedAt ||
      rival.claimedAt <= job.claimedAt;
    if (rival && rivalOlder) {
      await db.automationJob
        .updateMany({
          where: { id: job.id, claimedBy: workerId, status: "RUNNING" },
          data: {
            status: "QUEUED",
            claimedBy: null,
            claimedAt: null,
            leaseUntil: null,
          },
        })
        .catch(() => ({ count: 0 }));
      // No attempt bookkeeping here: no attempt row was opened yet for this
      // claim (rows open below, for kept jobs only), and the release is not a
      // failure — the attempts ladder is untouched, the job simply retries
      // once the key is free.
      continue;
    }
    kept.push(job);
  }

  // Open an attempt row per kept job — the per-attempt evidence the console
  // shows. Best-effort: attempt bookkeeping must never fail the claim.
  // (Released jobs already closed their attempt above as RECLAIMED.)
  await Promise.all(
    kept.map((job) =>
      db.automationAttempt
        .create({
          data: {
            jobId: job.id,
            attempt: job.attempts + 1,
            workerId,
            status: "RUNNING",
            startedAt: now,
          },
        })
        .catch(() => null)
    )
  );

  return kept;
}

/**
 * Close a job's open attempt row (the newest RUNNING one) with its terminal
 * outcome, recording duration and failure category. Best-effort — attempt
 * bookkeeping must never fail the queue.
 */
async function closeAttempt(
  jobId: string,
  outcome: {
    status: "SUCCEEDED" | "FAILED" | "RECLAIMED";
    failureCategory?: string | null;
    error?: string | null;
    finishedAt: Date;
  },
  client: DbUnit = db
): Promise<void> {
  const open = await client.automationAttempt
    .findFirst({
      where: { jobId, status: "RUNNING" },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    })
    .catch(() => null);
  if (!open) return;
  await client.automationAttempt
    .update({
      where: { id: open.id },
      data: {
        status: outcome.status,
        failureCategory: outcome.failureCategory ?? null,
        error: outcome.error ? outcome.error.slice(0, 500) : null,
        finishedAt: outcome.finishedAt,
        durationMs: Math.max(
          0,
          outcome.finishedAt.getTime() - open.startedAt.getTime()
        ),
      },
    })
    .catch(() => undefined);
}

/**
 * Mark a job done: status write + attempt close are ONE atomic unit — on pg
 * inside $transaction (or the caller's tenant tx when threaded), on
 * Neon-HTTP sequential best-effort as before. Never throws.
 */
export async function completeAutomationJob(
  id: string,
  client: DbUnit = db
): Promise<void> {
  const now = new Date();
  const unit = async (c: DbUnit) => {
    await c.automationJob
      .update({
        where: { id },
        data: {
          status: "SUCCEEDED",
          finishedAt: now,
          leaseUntil: null,
          lastError: null,
          failureCategory: null,
        },
      })
      .catch(() => undefined);
    await closeAttempt(id, { status: "SUCCEEDED", finishedAt: now }, c);
  };
  if (client !== db) {
    await unit(client).catch(() => undefined);
  } else if (supportsInteractiveTx()) {
    await db.$transaction((tx) => unit(tx)).catch(() => undefined);
  } else {
    await unit(db).catch(() => undefined);
  }
}

type FailureTransition = {
  status: "QUEUED" | "DEAD";
  data: Prisma.AutomationJobUpdateInput;
};

/**
 * The field set applied to a job whose attempt just failed: bump the attempt
 * count, then either re-queue behind the exponential backoff or escalate to
 * DEAD (the DLQ). Shared by `failAutomationJob` and `reclaimStaleJobs` so the
 * retry→DLQ ladder has exactly one definition. The caller decides the write's
 * guard — `failAutomationJob` writes unconditionally, `reclaimStaleJobs` only
 * while the row is still RUNNING.
 */
function failureTransition(
  priorAttempts: number,
  maxAttempts: number,
  now: Date,
  lastError: string
): FailureTransition {
  const attempts = priorAttempts + 1;
  const status = nextStatusOnFailure(attempts, maxAttempts);
  return {
    status,
    data: {
      attempts,
      status,
      lastError: lastError.slice(0, 500),
      failureCategory: failureCategory(lastError),
      claimedBy: null,
      claimedAt: null,
      leaseUntil: null,
      notBefore: status === "QUEUED" ? backoffUntil(attempts, now) : now,
      finishedAt: status === "DEAD" ? now : null,
    },
  };
}

/**
 * Record a failed attempt: re-queue after exponential backoff, or escalate to
 * DEAD once the retry budget is spent.
 */
/**
 * Record a failed attempt: re-queue after exponential backoff, or escalate to
 * DEAD once the retry budget is spent. Status write + attempt close are one
 * atomic unit under the same rules as completeAutomationJob. A row invisible
 * to the threaded tenant context behaves like a missing row (returns DEAD
 * without writing) — the global reclaim path, which sees every row, still
 * owns the retry ladder, so nothing is lost, only deferred.
 */
export async function failAutomationJob(
  id: string,
  error: string,
  policy?: { maxAttempts: number },
  client: DbUnit = db
): Promise<"QUEUED" | "DEAD"> {
  const job = await client.automationJob
    .findUnique({
      where: { id },
      select: { attempts: true, maxAttempts: true },
    })
    .catch(() => null);
  if (!job) return "DEAD";
  const maxAttempts = policy?.maxAttempts ?? job.maxAttempts;
  const now = new Date();
  const { status, data } = failureTransition(
    job.attempts,
    maxAttempts,
    now,
    error
  );
  const unit = async (c: DbUnit) => {
    await c.automationJob
      .update({ where: { id }, data })
      .catch(() => undefined);
    await closeAttempt(
      id,
      {
        status: "FAILED",
        failureCategory: failureCategory(error),
        error,
        finishedAt: now,
      },
      c
    );
  };
  if (client !== db) {
    await unit(client).catch(() => undefined);
  } else if (supportsInteractiveTx()) {
    await db.$transaction((tx) => unit(tx)).catch(() => undefined);
  } else {
    await unit(db).catch(() => undefined);
  }
  return status;
}

/**
 * Return orphaned jobs to the queue: a RUNNING job whose lease lapsed means the
 * owning process died mid-run. Re-queued with an incremented attempt so a
 * poisoned job still reaches the DLQ rather than looping forever.
 */
export async function reclaimStaleJobs(now = new Date()): Promise<number> {
  const running = await db.automationJob
    .findMany({
      where: { status: "RUNNING" },
      select: { id: true, attempts: true, maxAttempts: true, leaseUntil: true },
      take: 200,
    })
    .catch(() => []);
  let reclaimed = 0;
  for (const job of running) {
    if (!isLeaseExpired(job.leaseUntil, now)) continue;
    const reason = "lease expired — worker did not heartbeat (job reclaimed)";
    const { data } = failureTransition(
      job.attempts,
      job.maxAttempts,
      now,
      reason
    );
    // Conditional: only reclaim while the row is still RUNNING.
    const res = await db.automationJob
      .updateMany({ where: { id: job.id, status: "RUNNING" }, data })
      .catch(() => ({ count: 0 }));
    if (res.count > 0) {
      await closeAttempt(job.id, {
        status: "RECLAIMED",
        failureCategory: failureCategory(reason),
        error: reason,
        finishedAt: now,
      });
    }
    reclaimed += res.count;
  }
  return reclaimed;
}

/** Retention: drop finished jobs older than `days` (keeps the table from growing). */
export async function pruneAutomationJobs(days = 14): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
  const res = await db.automationJob
    .deleteMany({
      where: {
        status: { in: ["SUCCEEDED", "DEAD"] },
        finishedAt: { lte: cutoff },
      },
    })
    .catch(() => ({ count: 0 }));
  return res.count;
}

// ───────────────────────────── observability ─────────────────────────────

export type QueueStats = {
  queued: number;
  running: number;
  succeeded: number;
  dead: number;
  /** DLQ entries by escalation severity — triage order for an operator. */
  deadBySeverity: Record<string, number>;
  maxConcurrent: number;
  paused: boolean;
};

export async function automationQueueStats(): Promise<QueueStats> {
  const [queued, running, succeeded, deadRows, governor] = await Promise.all([
    db.automationJob.count({ where: { status: "QUEUED" } }).catch(() => 0),
    db.automationJob.count({ where: { status: "RUNNING" } }).catch(() => 0),
    db.automationJob.count({ where: { status: "SUCCEEDED" } }).catch(() => 0),
    db.automationJob
      .findMany({
        where: { status: "DEAD" },
        select: { attempts: true, maxAttempts: true },
        take: 500,
      })
      .catch(() => []),
    readGovernor(),
  ]);
  const deadBySeverity: Record<string, number> = {};
  for (const row of deadRows) {
    const sev = escalationSeverity(row.attempts, row.maxAttempts);
    deadBySeverity[sev] = (deadBySeverity[sev] ?? 0) + 1;
  }
  return {
    queued,
    running,
    succeeded,
    dead: deadRows.length,
    deadBySeverity,
    maxConcurrent: governor.maxConcurrent,
    paused: governor.paused,
  };
}

export type DeadJob = {
  id: string;
  topic: string;
  attempts: number;
  maxAttempts: number;
  /** Escalation tier derived from the attempts/maxAttempts ratio. */
  severity: "NONE" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Failure category for triage (TIMEOUT | UPSTREAM_5XX | VALIDATION | …). */
  failureCategory: string | null;
  lastError: string | null;
  correlationId: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/**
 * The dead-letter queue — escalated jobs an operator can inspect and replay.
 *
 * `automationQueueStats` only counts DEAD rows; a count with no list is a number
 * nobody can act on, so this returns the actual rows (newest first, bounded).
 */
export async function listDeadJobs(limit = 50): Promise<DeadJob[]> {
  const rows = await db.automationJob
    .findMany({
      where: { status: "DEAD" },
      orderBy: { finishedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    })
    .catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    severity: escalationSeverity(r.attempts, r.maxAttempts),
    failureCategory: r.failureCategory,
    lastError: r.lastError,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));
}

/**
 * Return a DEAD job to the queue (operator replay). Resets the attempt budget so
 * the job gets a fresh set of retries; only a job currently in the DLQ is
 * touched, so a replay cannot resurrect a job that already succeeded.
 */
export async function requeueAutomationJob(id: string): Promise<boolean> {
  const res = await db.automationJob
    .updateMany({
      where: { id, status: "DEAD" },
      data: {
        status: "QUEUED",
        attempts: 0,
        notBefore: new Date(),
        claimedBy: null,
        claimedAt: null,
        leaseUntil: null,
        finishedAt: null,
        failureCategory: null,
      },
    })
    .catch(() => ({ count: 0 }));
  return res.count > 0;
}

/**
 * Renew a job's lease — the heartbeat that keeps a long-running job from being
 * reclaimed mid-run.
 *
 * The write is CONDITIONAL on the row still being RUNNING and still owned by
 * this worker, so a job that was reclaimed or completed is never resurrected by
 * a stale worker's heartbeat. Returns true when the lease was renewed.
 */
export async function heartbeatAutomationJob(
  id: string,
  workerId: string,
  leaseMs = DEFAULT_LEASE_MS
): Promise<boolean> {
  const now = new Date();
  const res = await db.automationJob
    .updateMany({
      where: { id, status: "RUNNING", claimedBy: workerId },
      data: { leaseUntil: leaseUntil(now, leaseMs) },
    })
    .catch(() => ({ count: 0 }));
  return res.count > 0;
}

// ───────────────────────────── dispatch cycle ─────────────────────────────

export type DispatchReport = {
  reclaimed: number;
  planned: number;
  started: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  paused: boolean;
  /** Expired durable-waitpoint wakes reaped this cycle (Trigger.dev-style). */
  waitpointsExpired: number;
};

/**
 * Run one job's finish unit (complete/fail + attempt close) inside its
 * tenant context when possible: pg driver + job carries an orgId. Otherwise
 * the global client (org-less system jobs, Neon-HTTP). A thrown scope (tx
 * timeout) leaves the job RUNNING for reclaim — rolled back, never
 * half-written — so callers count it as retried.
 */
async function finishJobScoped<T>(
  job: { id: string; orgId: string | null },
  fn: (client: DbUnit) => Promise<T>
): Promise<T> {
  if (job.orgId && supportsInteractiveTx()) {
    return withTenantContext(job.orgId, (tx) => fn(tx));
  }
  return fn(db);
}

let cycleRunning = false;

/**
 * One dispatch cycle: plan against the governor, claim, execute, report.
 *
 * Re-entrancy guarded so a slow cycle cannot overlap itself in one process.
 * The heavy lifting is delegated to `emitAutomationEvent`, which performs the
 * org-scoped in-app fan-out — the queue adds durability, retries and
 * back-pressure on top of the engine rather than replacing it.
 */
export async function runAutomationDispatchCycle(
  workerId = `worker-${process.pid}`
): Promise<DispatchReport> {
  const report: DispatchReport = {
    reclaimed: 0,
    planned: 0,
    started: 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    paused: false,
    waitpointsExpired: 0,
  };
  if (cycleRunning) return report;
  cycleRunning = true;
  try {
    report.reclaimed = await reclaimStaleJobs();
    // Durable wakes: reap expired waitpoints so paused runs whose timer/event
    // will never arrive do not wait forever. Best-effort, never fails the cycle.
    // Lazy import — waitpoints.ts is Prisma-free at module top-level, but the
    // lazy edge keeps the queue's dependency direction one-way (queue → waits).
    const { expireWaitpoints } = await import("@/lib/automation/waitpoints");
    report.waitpointsExpired = await expireWaitpoints().catch(() => 0);

    const governor = await readGovernor();
    const [queued, running] = await Promise.all([
      db.automationJob
        .count({ where: { status: "QUEUED", notBefore: { lte: new Date() } } })
        .catch(() => 0),
      db.automationJob.count({ where: { status: "RUNNING" } }).catch(() => 0),
    ]);
    const plan = planDispatch({
      queued,
      running,
      maxConcurrent: governor.maxConcurrent,
      batchSize: governor.batchSize,
      paused: governor.paused,
    });
    report.planned = plan.capacity;
    report.paused = plan.paused;
    if (plan.capacity === 0) return report;

    // Per-class enforcement: classes at cap contribute no candidates to this
    // cycle. Computed from live RUNNING counts right here so the claim and
    // the capacity check cannot drift apart across cycles.
    const runningGroups = await db.automationJob
      .groupBy({
        by: ["workerClass"],
        where: { status: "RUNNING" },
        _count: true,
      })
      .catch(() => [] as Array<{ workerClass: string | null; _count: number }>);
    const runningByClass: Partial<Record<WorkerClass, number>> = {};
    for (const g of runningGroups) {
      const cls = (g.workerClass as WorkerClass | null) ?? "DEFAULT";
      runningByClass[cls] = (runningByClass[cls] ?? 0) + g._count;
    }
    const allowedClasses = classesWithCapacity(runningByClass, {
      perClass: governor.perClass,
    });
    if (allowedClasses.length === 0) return report;

    const jobs = await claimAutomationJobs(
      workerId,
      plan.capacity,
      allowedClasses
    );
    report.started = jobs.length;

    // Imported lazily: adapters/automation → workflow-engine → this module would
    // otherwise form an import cycle.
    const { emitAutomationEvent } = await import("@/lib/adapters/automation");

    for (const job of jobs) {
      // Heartbeat: renew the lease while this job runs, so a job that
      // legitimately takes longer than the lease is not reclaimed and re-run by
      // the next cycle (which would duplicate its side effects). The interval is
      // a third of the lease; `shouldRenewLease` renews once the lease is within
      // one interval of lapsing, so a third of the lease is always in hand.
      // Cleared in the finally below — a finished job is never re-leased.
      let leaseExpiresAt = leaseUntil(new Date(), DEFAULT_LEASE_MS);
      const heartbeat = setInterval(() => {
        const now = new Date();
        if (!shouldRenewLease(leaseExpiresAt, now, DEFAULT_LEASE_MS)) return;
        leaseExpiresAt = leaseUntil(now, DEFAULT_LEASE_MS);
        void heartbeatAutomationJob(job.id, workerId).catch(() => undefined);
      }, heartbeatIntervalMs(DEFAULT_LEASE_MS));
      heartbeat.unref?.();
      try {
        let payload: AutomationPayload;
        try {
          payload = JSON.parse(job.payload) as AutomationPayload;
        } catch {
          // A payload that cannot be parsed will never parse, so retrying it is
          // pointless: escalate straight to the DLQ. `maxAttempts: 0` makes
          // `failAutomationJob` land on DEAD on its first recorded attempt.
          try {
            const next = await finishJobScoped(job, (c) =>
              failAutomationJob(
                job.id,
                "malformed job payload — not valid JSON",
                { maxAttempts: 0 },
                c
              )
            );
            if (next === "DEAD") report.deadLettered += 1;
            else report.retried += 1;
          } catch (err) {
            console.error(`[automation] scoped finish failed (${job.id})`, err);
            report.retried += 1;
          }
          continue;
        }
        try {
          const result = await emitAutomationEvent(
            job.topic as AutomationTopic,
            payload.data ?? {},
            {
              caseId: payload.caseId,
              actor: payload.actor,
              correlationId: payload.correlationId ?? job.id,
              orgId: job.orgId ?? undefined,
            }
          );
          if (result.delivered && result.status === "PROCESSED") {
            try {
              await finishJobScoped(job, (c) =>
                completeAutomationJob(job.id, c)
              );
              report.succeeded += 1;
            } catch (err) {
              console.error(
                `[automation] scoped finish failed (${job.id})`,
                err
              );
              report.retried += 1;
            }
          } else {
            try {
              const next = await finishJobScoped(job, (c) =>
                failAutomationJob(job.id, result.detail, undefined, c)
              );
              if (next === "DEAD") report.deadLettered += 1;
              else report.retried += 1;
            } catch (err) {
              console.error(
                `[automation] scoped finish failed (${job.id})`,
                err
              );
              report.retried += 1;
            }
          }
        } catch (err) {
          try {
            const next = await finishJobScoped(job, (c) =>
              failAutomationJob(
                job.id,
                err instanceof Error ? err.message : "unknown error",
                undefined,
                c
              )
            );
            if (next === "DEAD") report.deadLettered += 1;
            else report.retried += 1;
          } catch (scopeErr) {
            console.error(
              `[automation] scoped finish failed (${job.id})`,
              scopeErr
            );
            report.retried += 1;
          }
        }
      } finally {
        clearInterval(heartbeat);
      }
    }
    return report;
  } finally {
    cycleRunning = false;
  }
}

// ───────────────────────────── internal ticker ─────────────────────────────

let ticker: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process scheduler. No external cron, no uptime pinger, no
 * broker: the server drives its own durable queue on a fixed interval.
 * Idempotent — repeated calls are a no-op.
 */
export function startAutomationScheduler(intervalMs = 60_000): void {
  if (ticker) return;
  // P0-2 runner decision: on a serverless host the in-process ticker would
  // freeze between invocations — /api/cron/tick owns the dispatch cadence.
  if (isServerless()) {
    console.info(
      "[automation] in-process scheduler disabled on serverless (cron tick owns cadence)"
    );
    return;
  }
  ticker = setInterval(() => {
    const overlap = noteSweeperRun("in-process");
    if (overlap) {
      console.warn(
        `[automation] sweep overlap: ${
          overlap.driver
        } driver swept recently — duplicate work, idempotent (count=${sweepOverlapCountSinceBoot()})`
      );
    }
    void runAutomationDispatchCycle().catch((err) => {
      console.error("[automation] dispatch cycle failed", err);
    });
  }, intervalMs);
  // Never hold the process open just for the ticker.
  ticker.unref?.();
  // Boot catch-up: process anything that queued while the server was down.
  void runAutomationDispatchCycle().catch(() => undefined);
  console.info(
    `[automation] in-app scheduler started (every ${Math.round(
      intervalMs / 1000
    )}s)`
  );
}

/** Stop the scheduler (tests / graceful shutdown). */
export function stopAutomationScheduler(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}
