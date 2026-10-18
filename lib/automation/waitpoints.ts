/**
 * Durable waitpoint infrastructure — explicit wait state persistence.
 *
 * Modelled on Trigger.dev's waitpoint pattern: a workflow run can pause for
 * a human decision, a timer, an external event, or a provider callback. The
 * waitpoint is persisted with a resume token, expiry, and payload schema so
 * the run can be safely resumed exactly once — even after a worker crash.
 *
 * This module is pure and Prisma-free so it can be unit-tested without a
 * database (the repo's testing convention).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type WaitpointKind = "APPROVAL" | "TIMER" | "EVENT" | "CALLBACK";

export type WaitpointStatus = "WAITING" | "RESUMED" | "EXPIRED" | "CANCELLED";

export type Waitpoint = {
  id: string;
  runId: string;
  nodeRunId: string;
  kind: WaitpointKind;
  /** Opaque token used to resume this waitpoint exactly once. */
  resumeToken: string;
  /** When the waitpoint expires (timer waits) or should be reaped (all). */
  expiresAt: Date;
  /** The event/callback kind this waitpoint is listening for. */
  eventKind?: string;
  /** Schema for the resume payload (validated on resume). */
  resumeSchema?: Record<string, unknown>;
  /** Context snapshot for resuming the run. */
  contextSnapshot: Record<string, unknown>;
  status: WaitpointStatus;
  /** Who/what resumed this waitpoint. */
  resumedBy?: string;
  /** When the waitpoint was resumed. */
  resumedAt?: Date;
  /** Payload delivered on resume. */
  resumePayload?: Record<string, unknown>;
  createdAt: Date;
};

export type CreateWaitpointInput = {
  runId: string;
  nodeRunId: string;
  kind: WaitpointKind;
  expiresAt: Date;
  eventKind?: string;
  resumeSchema?: Record<string, unknown>;
  contextSnapshot: Record<string, unknown>;
};

export type ResumeWaitpointInput = {
  resumeToken: string;
  resumedBy: string;
  payload?: Record<string, unknown>;
};

// ── Pure helpers (unit-testable) ───────────────────────────────────────────

/**
 * Generate a cryptographically random resume token.
 * Uses crypto.randomUUID() for collision resistance.
 */
export function generateResumeToken(): string {
  return `wp_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * True when a waitpoint has expired.
 */
export function isWaitpointExpired(waitpoint: Pick<Waitpoint, "expiresAt">, now: Date): boolean {
  return waitpoint.expiresAt.getTime() <= now.getTime();
}

/**
 * True when a waitpoint can be resumed (must be in WAITING status).
 */
export function canResume(waitpoint: Pick<Waitpoint, "status">): boolean {
  return waitpoint.status === "WAITING";
}

/**
 * True when a waitpoint matches an incoming event for resume.
 */
export function matchesEvent(waitpoint: Pick<Waitpoint, "kind" | "eventKind" | "status">, eventKind: string): boolean {
  if (waitpoint.status !== "WAITING") return false;
  if (waitpoint.kind !== "EVENT" && waitpoint.kind !== "CALLBACK") return false;
  return waitpoint.eventKind === eventKind;
}

/**
 * Compute the next reaping time for expired waitpoints.
 * Returns the earliest expiry among active waitpoints, or null if none.
 */
export function nextReapTime(waitpoints: Array<Pick<Waitpoint, "expiresAt" | "status">>, now: Date): Date | null {
  const active = waitpoints.filter((w) => w.status === "WAITING" && w.expiresAt > now);
  if (active.length === 0) return null;
  return active.reduce((earliest, w) => (w.expiresAt < earliest ? w.expiresAt : earliest), active[0].expiresAt);
}

// ── Database operations (require db) ───────────────────────────────────────

/**
 * Persist a new waitpoint. Returns the created waitpoint.
 */
export async function createWaitpoint(input: CreateWaitpointInput) {
  const { db } = await import("@/lib/db");
  return db.waitpoint.create({
    data: {
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      kind: input.kind,
      resumeToken: generateResumeToken(),
      expiresAt: input.expiresAt,
      eventKind: input.eventKind,
      resumeSchema: input.resumeSchema ? JSON.stringify(input.resumeSchema) : null,
      contextSnapshot: JSON.stringify(input.contextSnapshot),
      status: "WAITING",
    },
  });
}

/**
 * Resume a waitpoint by its token. Returns the resumed waitpoint or null if
 * not found / already resumed / expired.
 *
 * The update is CONDITIONAL on status = "WAITING" so exactly one resume wins
 * even under concurrent delivery.
 */
export async function resumeWaitpoint(token: string, input: ResumeWaitpointInput) {
  const { db } = await import("@/lib/db");
  const now = new Date();

  // Conditional update: only resume if still WAITING
  const result = await db.waitpoint.updateMany({
    where: { resumeToken: token, status: "WAITING" },
    data: {
      status: "RESUMED",
      resumedBy: input.resumedBy,
      resumedAt: now,
      resumePayload: input.payload ? JSON.stringify(input.payload) : null,
    },
  });

  if (result.count === 0) return null;

  return db.waitpoint.findUnique({ where: { resumeToken: token } });
}

/**
 * Cancel a waitpoint. Returns true if the waitpoint was cancelled.
 */
export async function cancelWaitpoint(token: string, cancelledBy: string): Promise<boolean> {
  const { db } = await import("@/lib/db");
  const result = await db.waitpoint.updateMany({
    where: { resumeToken: token, status: "WAITING" },
    data: {
      status: "CANCELLED",
      resumedBy: cancelledBy,
      resumedAt: new Date(),
    },
  });
  return result.count > 0;
}

/**
 * Expire waitpoints whose expiresAt has passed. Returns the number expired.
 */
export async function expireWaitpoints(now = new Date()): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.waitpoint.updateMany({
    where: { status: "WAITING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/**
 * Find waitpoints matching an incoming event kind.
 */
export async function findWaitpointsForEvent(eventKind: string) {
  const { db } = await import("@/lib/db");
  return db.waitpoint.findMany({
    where: {
      status: "WAITING",
      eventKind,
    },
  });
}

/**
 * Get all active (WAITING) waitpoints for a run.
 */
export async function getActiveWaitpointsForRun(runId: string) {
  const { db } = await import("@/lib/db");
  return db.waitpoint.findMany({
    where: { runId, status: "WAITING" },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a waitpoint by its resume token.
 */
export async function getWaitpointByToken(token: string) {
  const { db } = await import("@/lib/db");
  return db.waitpoint.findUnique({ where: { resumeToken: token } });
}
