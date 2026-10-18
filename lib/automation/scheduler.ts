/**
 * Durable automation scheduler — the pure, Prisma-free core.
 *
 * Reverse-engineered from two production systems rather than invented:
 *
 *  • **Windmill** — the database IS the queue. No Redis, no broker, no external
 *    scheduler; workers poll a table and claim rows under a lock. That is what
 *    makes automation self-contained here.
 *  • **Gastown's scheduler** — a config-driven *capacity governor* ("back-pressure
 *    for batched dispatch"), run as one step of a periodic daemon heartbeat,
 *    with a global pause/resume and a plan → execute → report dispatch cycle. Its
 *    heartbeats-and-escalation model is what the lease + retry ladder below
 *    encodes.
 *
 * The behavioural contract these functions pin:
 *   • work is claimed under a LEASE (a heartbeat); an expired lease means the
 *     owner died, so the job is reclaimed rather than lost;
 *   • failures retry with EXPONENTIAL BACKOFF and then escalate to DEAD (a
 *     dead-letter queue) — never silently dropped;
 *   • dispatch is capped by a CONCURRENCY governor so a burst of events cannot
 *     stampede the node executors.
 *
 * Kept dependency-free so it is unit-testable without a database.
 */

/** Default retry ceiling before a job escalates to DEAD (the DLQ). */
export const DEFAULT_MAX_ATTEMPTS = 5;
/** First retry delay; doubles each attempt. */
export const DEFAULT_BASE_BACKOFF_MS = 30_000; // 30s
/** Backoff ceiling, so the ladder does not grow without bound. */
export const DEFAULT_MAX_BACKOFF_MS = 60 * 60_000; // 1h
/** How long a worker's claim is valid before the job is considered orphaned. */
export const DEFAULT_LEASE_MS = 120_000; // 2 min
/** Jobs claimed per dispatch cycle (gastown's `batch_size`). */
export const DEFAULT_BATCH_SIZE = 10;
/** Concurrent RUNNING jobs allowed platform-wide (gastown's `max_polecats`).
 *  `0` means "no cap" — direct dispatch, matching gastown's `-1`/`0` modes. */
export const DEFAULT_MAX_CONCURRENT = 8;

export type RetryPolicy = {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  baseMs: DEFAULT_BASE_BACKOFF_MS,
  maxMs: DEFAULT_MAX_BACKOFF_MS,
};

/**
 * Exponential backoff for the Nth retry (1-based).
 *
 * `base * 2^(attempt-1)`, clamped to `maxMs`. Deterministic — no jitter — so the
 * behaviour is testable and a retry storm after a shared outage is still spread
 * across attempts rather than synchronised at a random point.
 *
 * ponytail: deterministic retry: no jitter — testable and spread-out by design.
 */
export function backoffMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): number {
  const n = Math.max(1, Math.floor(attempt));
  // Guard the shift so a large attempt count cannot overflow into Infinity.
  const raw = n > 20 ? policy.maxMs : policy.baseMs * 2 ** (n - 1);
  return Math.min(raw, policy.maxMs);
}

/** The instant a failed job becomes eligible again. */
export function backoffUntil(
  attempt: number,
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Date {
  return new Date(now.getTime() + backoffMs(attempt, policy));
}

/**
 * Status a job takes after a failure.
 * `QUEUED` = will be retried after its backoff; `DEAD` = escalated to the DLQ.
 * A nonsensical budget (NaN/Infinity) is treated as "no retries left".
 */
export function nextStatusOnFailure(
  attempts: number,
  maxAttempts: number
): "QUEUED" | "DEAD" {
  if (!Number.isFinite(attempts) || !Number.isFinite(maxAttempts))
    return "DEAD";
  return attempts < maxAttempts ? "QUEUED" : "DEAD";
}

/**
 * Escalation severity for a job's retry depth — a direct lift of gastown's
 * severity-routed escalation (MEDIUM → HIGH → CRITICAL). Surfaced so an operator
 * can triage the DLQ by how far a job got before giving up.
 */
export function escalationSeverity(
  attempts: number,
  maxAttempts: number
): "NONE" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (
    !Number.isFinite(attempts) ||
    !Number.isFinite(maxAttempts) ||
    maxAttempts <= 0
  )
    return "NONE";
  if (attempts >= maxAttempts) return "CRITICAL";
  const ratio = attempts / maxAttempts;
  if (ratio >= 0.66) return "HIGH";
  if (ratio >= 0.33) return "MEDIUM";
  return "NONE";
}

/** A claimed job is orphaned once its lease lapses (the owner stopped heartbeating). */
export function isLeaseExpired(
  leaseUntil: Date | null | undefined,
  now: Date
): boolean {
  if (!leaseUntil) return false; // a RUNNING row with no lease is not reclaimable by this rule
  return leaseUntil.getTime() <= now.getTime();
}

/** Minimal shape the eligibility rules need. */
export type SchedulableJob = {
  status: string;
  notBefore: Date;
  claims?: number;
};

/** A QUEUED job is eligible once its backoff gate has passed. */
export function isJobEligible(job: SchedulableJob, now: Date): boolean {
  return job.status === "QUEUED" && job.notBefore.getTime() <= now.getTime();
}

export type DispatchPlan = {
  /** How many jobs this cycle should claim. */
  capacity: number;
  /** Whether the global pause is in effect (dispatch suppressed entirely). */
  paused: boolean;
};

/**
 * Plan one dispatch cycle against the governor — gastown's
 * `PlanDispatch(availableCapacity, batchSize, ready)`.
 *
 * `maxConcurrent <= 0` means "no cap" (direct dispatch): the only bound is the
 * batch size. Otherwise the free capacity is `maxConcurrent - running`, and the
 * cycle claims `min(batchSize, freeCapacity, queued)`. A pause always wins.
 */
export function planDispatch(input: {
  queued: number;
  running: number;
  maxConcurrent?: number;
  batchSize?: number;
  paused?: boolean;
}): DispatchPlan {
  const batchSize = Math.max(0, input.batchSize ?? DEFAULT_BATCH_SIZE);
  const queued = Math.max(0, input.queued);
  const running = Math.max(0, input.running);
  if (input.paused) return { capacity: 0, paused: true };

  const maxConcurrent = input.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const free =
    maxConcurrent <= 0
      ? Number.POSITIVE_INFINITY
      : Math.max(0, maxConcurrent - running);
  const capacity = Math.max(0, Math.min(batchSize, free, queued));
  return { capacity, paused: false };
}

/** Next lease expiry for a freshly claimed job. */
export function leaseUntil(
  now: Date,
  leaseMs: number = DEFAULT_LEASE_MS
): Date {
  return new Date(now.getTime() + Math.max(1_000, leaseMs));
}

// ───────────────────────────── heartbeat ─────────────────────────────

/**
 * Default heartbeat cadence — a third of the lease, so a worker can miss two
 * consecutive renewals before its lease lapses. A job that legitimately runs
 * longer than the lease (OCR, AI drafting, DHL, a slow webhook) is kept alive
 * by renewing, instead of being reclaimed and re-run mid-flight.
 */
export const DEFAULT_HEARTBEAT_MS = 40_000; // ≈ DEFAULT_LEASE_MS / 3

/**
 * The heartbeat cadence for a lease: a third of it, floored at 1s.
 *
 * A third means two renewals can be missed before the lease lapses, so a
 * transient DB blip does not orphan a live job. The floor keeps a nonsensical
 * (zero/negative/NaN) lease from producing a zero interval, which would spin
 * the timer.
 */
export function heartbeatIntervalMs(
  leaseMs: number = DEFAULT_LEASE_MS
): number {
  const lease =
    Number.isFinite(leaseMs) && leaseMs > 0 ? leaseMs : DEFAULT_LEASE_MS;
  return Math.max(1_000, Math.floor(lease / 3));
}

/**
 * Whether a worker holding a lease should renew it now.
 *
 * True when the lease is missing, already lapsed, or within one heartbeat
 * interval of lapsing — i.e. when the next tick could otherwise let it expire.
 * Renewing earlier is a wasted write; renewing later risks a live job being
 * reclaimed mid-run (the duplicate-execution bug this guards against).
 */
export function shouldRenewLease(
  leaseUntil: Date | null | undefined,
  now: Date,
  leaseMs: number = DEFAULT_LEASE_MS
): boolean {
  if (!leaseUntil) return true;
  return leaseUntil.getTime() - now.getTime() <= heartbeatIntervalMs(leaseMs);
}

// ───────────────────────────── routing & triage ─────────────────────────────

export type ConcurrencyKeyInput = {
  topic: string;
  caseId?: string | null;
  orgId?: string | null;
};

/**
 * The per-key serialisation key for a job.
 *
 * Jobs sharing a key never run concurrently — the claim query skips a job whose
 * key already has a RUNNING job. Precedence: a case's events must not
 * interleave (`case:<id>`), then an org's (`org:<id>`), then the topic
 * (`topic:<topic>`) so unrelated topics still serialise rather than run
 * globally in parallel.
 */
export function concurrencyKeyFor(input: ConcurrencyKeyInput): string {
  if (input.caseId) return `case:${input.caseId}`;
  if (input.orgId) return `org:${input.orgId}`;
  return `topic:${input.topic}`;
}

export type WorkerClass = "OCR" | "AI" | "DHL" | "NOTIFY" | "DEFAULT";

/**
 * The worker class a topic belongs to — the routing label a per-class governor
 * can cap. Derived from the topic so it can never drift from the event.
 */
export function workerClassFor(topic: string): WorkerClass {
  const t = topic.toLowerCase();
  if (t.startsWith("ocr.") || t === "document.uploaded") return "OCR";
  if (
    t.startsWith("ai.") ||
    t === "selfbuild.completed" ||
    t === "prescan.completed" ||
    t === "triage.changed"
  )
    return "AI";
  if (t.startsWith("dispatch.") || t.includes("dhl") || t.includes("shipment"))
    return "DHL";
  if (
    t.startsWith("reminder.") ||
    t.startsWith("booking.") ||
    t === "message.received" ||
    t === "case.stale" ||
    t === "document.expiring"
  )
    return "NOTIFY";
  return "DEFAULT";
}

// ───────────────────────── stale-worker guard (Trigger.dev-style) ─────────────────────────

/**
 * How long a worker may go without a heartbeat before it is considered dead.
 * A multiple of the lease so a worker can miss renewals briefly (GC pause,
 * deploy) without its jobs being reclaimed from under a live process.
 */
export const DEFAULT_WORKER_STALE_AFTER_MS = DEFAULT_LEASE_MS * 3;

/**
 * True when a worker's last heartbeat is too old to trust — its RUNNING jobs
 * are orphans and `reclaimStaleJobs` must take them back. `lastHeartbeat ==
 * null` means the worker never heartbeated (claimed then died instantly).
 * Pure so the reclaim policy is unit-testable without a database.
 */
export function isWorkerStale(
  lastHeartbeat: Date | null | undefined,
  now: Date,
  staleAfterMs: number = DEFAULT_WORKER_STALE_AFTER_MS
): boolean {
  if (!lastHeartbeat) return true;
  const threshold =
    Number.isFinite(staleAfterMs) && staleAfterMs > 0
      ? staleAfterMs
      : DEFAULT_WORKER_STALE_AFTER_MS;
  return now.getTime() - lastHeartbeat.getTime() >= threshold;
}

// ───────────────────────── node execution budget ─────────────────────────

/** Default per-node execution budget (mirrors the catalog contract default). */
export const DEFAULT_NODE_TIMEOUT_MS = 30_000;

/** Error message used when a node exceeds its execution budget. */
export function nodeTimeoutError(pieceKey: string, timeoutMs: number): string {
  return `node ${pieceKey} timed out after ${timeoutMs}ms`;
}

/**
 * Race a node's execution against its timeout budget. `onTimeout` (when
 * given) fires as the budget lapses — the engine aborts the run's
 * AbortController there, so cancellable executors stop instead of running on
 * while the run is already marked TIMEOUT. Executors that cannot cancel keep
 * at-least-once semantics; the R3 step dedupe converges their late effects.
 * Pure promise plumbing, no I/O, unit-testable. Backward compatible: the
 * fourth parameter is optional and existing callers are unaffected.
 */
export function withNodeTimeout<T>(
  work: Promise<T>,
  pieceKey: string,
  timeoutMs: number = DEFAULT_NODE_TIMEOUT_MS,
  onTimeout?: () => void
): Promise<T> {
  const budget =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : DEFAULT_NODE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // An abort hook must never mask the timeout itself.
      }
      reject(new Error(nodeTimeoutError(pieceKey, budget)));
    }, budget);
    timer.unref?.();
  });
  return Promise.race([
    work.then(
      (v) => {
        if (timer) clearTimeout(timer);
        return v;
      },
      (e) => {
        if (timer) clearTimeout(timer);
        throw e;
      }
    ),
    timeout,
  ]);
}

// ───────────────────────── sweep-driver overlap marker ─────────────────────────

/** Who last drove a shared sweep: the cron tick or an in-process sweeper. */
export type SweepDriver = "tick" | "in-process";

type SweepMark = { driver: SweepDriver; at: number };

let lastSweepMark: SweepMark | null = null;
let sweepOverlapCount = 0;

/**
 * Record that a sweep driver fired. Returns the previous mark when a
 * DIFFERENT driver swept within the overlap window (default 5 min) — i.e.
 * the tick and an in-process sweeper are both driving and doing duplicate
 * work — and bumps the overlap counter. Same-driver repeats and quiet
 * periods return null. Callers log the returned mark as one overlap line.
 *
 * In-memory and best-effort (a restart resets it); the sweeps themselves
 * stay idempotent, so overlap is waste, never corruption.
 */
export function noteSweeperRun(
  driver: SweepDriver,
  now = Date.now(),
  windowMs = 5 * 60_000
): SweepMark | null {
  const prev = lastSweepMark;
  lastSweepMark = { driver, at: now };
  if (prev && prev.driver !== driver && now - prev.at < windowMs) {
    sweepOverlapCount += 1;
    return prev;
  }
  return null;
}

/** How many cross-driver overlaps have been observed since boot. */
export function sweepOverlapCountSinceBoot(): number {
  return sweepOverlapCount;
}

/** Reset overlap state (tests only). */
export function resetSweeperMarks(): void {
  lastSweepMark = null;
  sweepOverlapCount = 0;
}

// ───────────────────────── per-class governor ─────────────────────────

export type ClassGovernor = {
  /** Max concurrent RUNNING jobs per worker class (absent = uncapped). */
  perClass?: Partial<Record<WorkerClass, number>>;
};

/**
 * Per-worker-class capacity check (n8n-style isolated capacity): a burst of
 * OCR jobs must not starve notification delivery. Returns the classes that
 * still have free capacity given current RUNNING counts. Pure/testable.
 */
export function classesWithCapacity(
  runningByClass: Partial<Record<WorkerClass, number>>,
  governor: ClassGovernor = {}
): WorkerClass[] {
  const classes: WorkerClass[] = ["OCR", "AI", "DHL", "NOTIFY", "DEFAULT"];
  return classes.filter((c) => {
    const cap = governor.perClass?.[c];
    if (cap === undefined || cap <= 0) return true; // uncapped
    return (runningByClass[c] ?? 0) < cap;
  });
}

export type FailureCategory =
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "UPSTREAM_5XX"
  | "UPSTREAM_4XX"
  | "VALIDATION"
  | "NETWORK"
  | "UNKNOWN";

/**
 * Classify a failure for DLQ triage — a chip an operator can scan faster than
 * reading `lastError`. Deterministic and I/O-free, so it is unit-testable.
 */
export function failureCategory(err: unknown): FailureCategory {
  const msg = (
    err instanceof Error ? err.message : typeof err === "string" ? err : ""
  ).toLowerCase();
  if (!msg) return "UNKNOWN";
  if (
    msg.includes("lease expired") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("abort")
  )
    return "TIMEOUT";
  if (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  )
    return "RATE_LIMIT";
  if (
    /\b5\d\d\b/.test(msg) ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("internal server error")
  )
    return "UPSTREAM_5XX";
  if (
    /\b4\d\d\b/.test(msg) ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("not found")
  )
    return "UPSTREAM_4XX";
  if (
    msg.includes("validation") ||
    msg.includes("invalid") ||
    msg.includes("malformed") ||
    msg.includes("required")
  )
    return "VALIDATION";
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("unreachable")
  )
    return "NETWORK";
  return "UNKNOWN";
}
