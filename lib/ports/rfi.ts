/**
 * H2 ports — RFI thread persistence and audit (ADR-004 strangler, slice by slice).
 *
 * The RFI use cases (src/lib/services/rfi.ts) orchestrate against these
 * contracts only; the Prisma adapter at src/lib/adapters/prisma-rfi-store.ts
 * is the edge. Fake-port unit tests inject the in-memory fake below.
 *
 * Structural types only: Prisma-free, safe to import anywhere.
 */
import type { RfiStatus, RfiTurnKind } from "@/lib/domain/rfi";

export interface PersistedTurn {
  id: string;
  threadId: string;
  kind: RfiTurnKind;
  body: string;
  authorId: string | null;
  authorRole: string | null;
  authorLabel: string;
  createdAt: Date;
}

export interface PersistedThread {
  id: string;
  orgId: string;
  caseId: string;
  subject: string;
  status: RfiStatus;
  ownerId: string | null;
  documentRequestId: string | null;
  slaDueAt: Date | null;
  slaHours: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  turns: PersistedTurn[];
}
export interface OpenThreadRecord {
  orgId: string;
  caseId: string;
  subject: string;
  status: RfiStatus;
  ownerId: string | null;
  documentRequestId: string | null;
  slaDueAt: Date | null;
  slaHours: number;
  createdBy: string;
  openingTurn: { kind: "QUESTION"; body: string; authorId: string; authorRole: string; authorLabel: string };
}

export interface AppendTurnRecord {
  kind: RfiTurnKind;
  body: string;
  authorId: string | null;
  authorRole: string | null;
  authorLabel: string;
  /** Status the thread lands in after this turn (domain-decided). */
  nextStatus: RfiStatus;
  /** Re-armed SLA (QUESTION) or disarmed (ANSWER: null). NOTE leaves it untouched. */
  nextSlaDueAt: Date | "UNCHANGED" | null;
}

export interface RfiStore {
  openThread(record: OpenThreadRecord): Promise<PersistedThread>;
  appendTurn(threadId: string, record: AppendTurnRecord): Promise<PersistedThread>;
  setStatus(threadId: string, status: RfiStatus, systemNote: string | null): Promise<PersistedThread>;
  threadById(orgId: string, threadId: string): Promise<PersistedThread | null>;
  threadsForCase(orgId: string, caseId: string): Promise<PersistedThread[]>;
  /** OPEN threads with an armed SLA at or before now — the deadline runner feed. */
  overdueOpenThreads(now: Date, limit?: number): Promise<PersistedThread[]>;
}
/** Minimal case context the use cases need (supplied by the route via Prisma). */
export interface RfiCaseContext {
  id: string;
  orgId: string;
  clientId: string;
  status: string;
  rmAssignedId: string | null;
}

/** Audit sink — every turn and transition lands here; routes pass the real audit. */
export interface RfiAudit {
  record(entry: {
    orgId: string;
    actorId: string | null;
    actorLabel: string;
    action: string;
    target: string;
    reason?: string;
    correlationId?: string;
  }): Promise<void>;
}

/** H3 offline default — resolves to nothing, so no RFI write arms offline. */
export const offlineRfiStore: RfiStore = {
  openThread: async () => null as never,
  appendTurn: async () => null as never,
  setStatus: async () => null as never,
  threadById: async () => null,
  threadsForCase: async () => [],
  overdueOpenThreads: async () => [],
};
export interface FakeRfiStore extends RfiStore {
  rows: Map<string, PersistedThread>;
}

/** In-memory fake for unit specs — deterministic, no clock surprises. */
export function createFakeRfiStore(seed: PersistedThread[] = []): FakeRfiStore {
  const rows = new Map<string, PersistedThread>(seed.map((t) => [t.id, structuredClone(t)]));
  let seq = rows.size;
  const nextId = (prefix: string): string => {
    seq += 1;
    return prefix + "_" + String(seq).padStart(4, "0");
  };
  const clone = (t: PersistedThread): PersistedThread => structuredClone(t);
  return {
    rows,
    openThread: async (record) => {
      const now = new Date();
      const turn: PersistedTurn = {
        id: nextId("turn"),
        threadId: "",
        kind: record.openingTurn.kind,
        body: record.openingTurn.body,
        authorId: record.openingTurn.authorId,
        authorRole: record.openingTurn.authorRole,
        authorLabel: record.openingTurn.authorLabel,
        createdAt: now,
      };
      const thread: PersistedThread = {
        id: nextId("rfi"),
        orgId: record.orgId,
        caseId: record.caseId,
        subject: record.subject,
        status: record.status,
        ownerId: record.ownerId,
        documentRequestId: record.documentRequestId,
        slaDueAt: record.slaDueAt,
        slaHours: record.slaHours,
        createdBy: record.createdBy,
        createdAt: now,
        updatedAt: now,
        turns: [turn],
      };
      turn.threadId = thread.id;
      rows.set(thread.id, thread);
      return clone(thread);
    },
    appendTurn: async (threadId, record) => {
      const thread = rows.get(threadId);
      if (!thread) throw new Error("thread not found: " + threadId);
      thread.turns.push({
        id: nextId("turn"),
        threadId,
        kind: record.kind,
        body: record.body,
        authorId: record.authorId,
        authorRole: record.authorRole,
        authorLabel: record.authorLabel,
        createdAt: new Date(),
      });
      thread.status = record.nextStatus;
      if (record.nextSlaDueAt !== "UNCHANGED") thread.slaDueAt = record.nextSlaDueAt;
      thread.updatedAt = new Date();
      return clone(thread);
    },
    setStatus: async (threadId, status, systemNote) => {
      const thread = rows.get(threadId);
      if (!thread) throw new Error("thread not found: " + threadId);
      thread.status = status;
      if (systemNote) {
        thread.turns.push({
          id: nextId("turn"),
          threadId,
          kind: "SYSTEM",
          body: systemNote,
          authorId: null,
          authorRole: "SYSTEM",
          authorLabel: "system",
          createdAt: new Date(),
        });
      }
      thread.updatedAt = new Date();
      return clone(thread);
    },
    threadById: async (orgId, threadId) => {
      const thread = rows.get(threadId);
      if (!thread || thread.orgId !== orgId) return null;
      return clone(thread);
    },
    threadsForCase: async (orgId, caseId) =>
      [...rows.values()]
        .filter((t) => t.orgId === orgId && t.caseId === caseId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(clone),
    overdueOpenThreads: async (now, limit) => {
      const cap = limit === undefined ? 50 : limit;
      return [...rows.values()]
        .filter((t) => t.status === "OPEN" && t.slaDueAt !== null && (t.slaDueAt as Date).getTime() <= now.getTime())
        .sort((a, b) => {
          const at = (a.slaDueAt as Date).getTime();
          const bt = (b.slaDueAt as Date).getTime();
          return at < bt ? -1 : 1;
        })
        .slice(0, cap)
        .map(clone);
    },
  };
}

export interface FakeRfiAudit extends RfiAudit {
  entries: Array<{ action: string; target: string }>;
}

/** In-memory audit sink for specs — asserts every turn was audit-logged. */
export function createFakeRfiAudit(): FakeRfiAudit {
  const entries: Array<{ action: string; target: string }> = [];
  return {
    entries,
    record: async (entry) => {
      entries.push({ action: entry.action, target: entry.target });
    },
  };
}



