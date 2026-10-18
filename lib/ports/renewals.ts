/**
 * H2 ports - renewal / aftercare track (ADR-006).
 *
 * Use cases (src/lib/services/renewal-track.ts) depend ONLY on these
 * contracts; Prisma adapters live at the edge (src/lib/adapters/renewals.ts)
 * behind one composition root. Strangler-safe: the old direct-Prisma route
 * path keeps working until each slice cuts over.
 *
 * Structural types only: Prisma-free, safe to import anywhere.
 * H3 offline defaults below resolve to memory / no-op so offline paths
 * (tests, degraded boot) stay silent without a database or network.
 */

export interface RenewalRecord {
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
}

export interface RenewalStorePort {
  create(input: {
    orgId: string;
    caseId: string | null;
    clientId: string;
    kind: string;
    title: string;
    notes: string | null;
    dueAt: Date;
    remindAt: Date | null;
    status: string;
  }): Promise<RenewalRecord>;
  findById(id: string): Promise<RenewalRecord | null>;
  /** Confirmed obligations inside the radar window (the sweep candidate set). */
  listFirable(now: Date): Promise<RenewalRecord[]>;
  listForClient(clientId: string): Promise<RenewalRecord[]>;
  setStatus(id: string, status: string): Promise<RenewalRecord | null>;
}

export interface RenewalSinkPort {
  /** Durable queue entry so the obligation survives restarts (retry + DLQ). */
  enqueueReminderJob(input: {
    renewal: RenewalRecord;
    delayMs: number;
    dedupeKey: string;
  }): Promise<void>;
  /** Client-facing reminder on the shared Reminder ledger (deadline cadence). */
  scheduleClientReminder(input: {
    renewal: RenewalRecord;
    dedupeKey: string;
    dueAt: Date;
  }): Promise<void>;
  /** RM task so the desk owns the chase (idempotent per obligation). */
  ensureRmTask(input: { renewal: RenewalRecord; marker: string }): Promise<void>;
  /** Timeline + notify fan-out through the case event hub / notify matrix. */
  emitRenewalEvent(input: {
    renewal: RenewalRecord;
    topic: string;
    actorLabel: string;
    dedupeKey: string;
  }): Promise<void>;
}

export interface RenewalPorts {
  store: RenewalStorePort;
  sink: RenewalSinkPort;
}

/** H3 offline sink - records nothing, resolves. */
export const offlineRenewalSink: RenewalSinkPort = {
  enqueueReminderJob: async () => undefined,
  scheduleClientReminder: async () => undefined,
  ensureRmTask: async () => undefined,
  emitRenewalEvent: async () => undefined,
};

/**
 * In-memory store (H3 + fake-port tests): deterministic, no I/O.
 * Respects the same contract as the Prisma adapter - tenant checks stay in
 * the use cases / routes, never here.
 */
export function memoryRenewalStore(seed: RenewalRecord[] = []): RenewalStorePort & { rows: RenewalRecord[] } {
  const rows: RenewalRecord[] = seed.map((r) => ({ ...r }));
  let seq = rows.length;
  const store: RenewalStorePort & { rows: RenewalRecord[] } = {
    rows,
    create: async (input) => {
      seq += 1;
      const row: RenewalRecord = { id: "ren-" + String(seq), ...input };
      rows.push(row);
      return { ...row };
    },
    findById: async (id) => {
      const found = rows.find((r) => r.id === id);
      return found ? { ...found } : null;
    },
    listFirable: async (now) =>
      rows
        .filter((r) => r.status === "OPEN" && (r.remindAt === null || r.remindAt.getTime() <= now.getTime()))
        .map((r) => ({ ...r })),
    listForClient: async (clientId) => rows.filter((r) => r.clientId === clientId).map((r) => ({ ...r })),
    setStatus: async (id, status) => {
      const found = rows.find((r) => r.id === id);
      if (!found) return null;
      found.status = status;
      return { ...found };
    },
  };
  return store;
}

/** Recording sink for fake-port tests: captures every side effect. */
export function recordingRenewalSink(): RenewalSinkPort & {
  jobs: Array<{ renewalId: string; delayMs: number; dedupeKey: string }>;
  reminders: Array<{ renewalId: string; dedupeKey: string }>;
  tasks: Array<{ renewalId: string; marker: string }>;
  events: Array<{ renewalId: string; topic: string; dedupeKey: string }>;
} {
  const jobs: Array<{ renewalId: string; delayMs: number; dedupeKey: string }> = [];
  const reminders: Array<{ renewalId: string; dedupeKey: string }> = [];
  const tasks: Array<{ renewalId: string; marker: string }> = [];
  const events: Array<{ renewalId: string; topic: string; dedupeKey: string }> = [];
  return {
    jobs,
    reminders,
    tasks,
    events,
    enqueueReminderJob: async (input) => {
      jobs.push({ renewalId: input.renewal.id, delayMs: input.delayMs, dedupeKey: input.dedupeKey });
    },
    scheduleClientReminder: async (input) => {
      reminders.push({ renewalId: input.renewal.id, dedupeKey: input.dedupeKey });
    },
    ensureRmTask: async (input) => {
      tasks.push({ renewalId: input.renewal.id, marker: input.marker });
    },
    emitRenewalEvent: async (input) => {
      events.push({ renewalId: input.renewal.id, topic: input.topic, dedupeKey: input.dedupeKey });
    },
  };
}
