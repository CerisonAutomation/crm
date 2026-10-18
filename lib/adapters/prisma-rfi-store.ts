/**
 * Prisma adapter for the RfiStore port (ADR-004: adapters at the edge).
 *
 * The only module that imports the database for RFI reads/writes. Use cases
 * stay Prisma-free behind the port; this file plus the route handlers form
 * the composition root. Idempotency rides the callers dedupe discipline:
 * threads are opened with an explicit idempotencyKey check in the route.
 */
import { db } from "@/lib/db";
import { audit as recordAudit } from "@/lib/api-helpers";
import type { RfiStatus, RfiTurnKind } from "@/lib/domain/rfi";
import type {
  AppendTurnRecord,
  OpenThreadRecord,
  PersistedThread,
  PersistedTurn,
  RfiAudit,
  RfiStore,
} from "@/lib/ports/rfi";
import {
  appendRfiTurn,
  closeRfiThread,
  escalateOverdueThreads,
  escalateRfiThread,
  openRfiThread,
} from "@/lib/services/rfi";
import type { RfiActor, RfiDeps } from "@/lib/services/rfi";

type ThreadRow = {
  id: string;
  orgId: string;
  caseId: string;
  subject: string;
  status: string;
  ownerId: string | null;
  documentRequestId: string | null;
  slaDueAt: Date | null;
  slaHours: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  turns: TurnRow[];
};

type TurnRow = {
  id: string;
  threadId: string;
  kind: string;
  body: string;
  authorId: string | null;
  authorRole: string | null;
  authorLabel: string;
  createdAt: Date;
};

function toTurn(row: TurnRow): PersistedTurn {
  return {
    id: row.id,
    threadId: row.threadId,
    kind: row.kind as RfiTurnKind,
    body: row.body,
    authorId: row.authorId,
    authorRole: row.authorRole,
    authorLabel: row.authorLabel,
    createdAt: row.createdAt,
  };
}

function toThread(row: ThreadRow): PersistedThread {
  return {
    id: row.id,
    orgId: row.orgId,
    caseId: row.caseId,
    subject: row.subject,
    status: row.status as RfiStatus,
    ownerId: row.ownerId,
    documentRequestId: row.documentRequestId,
    slaDueAt: row.slaDueAt,
    slaHours: row.slaHours,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    turns: row.turns.map(toTurn),
  };
}

const withTurns = { turns: { orderBy: { createdAt: "asc" as const } } };

const prismaRfiStore: RfiStore = {
  openThread: async (record: OpenThreadRecord) => {
    const row = (await db.rfiThread.create({
      data: {
        orgId: record.orgId,
        caseId: record.caseId,
        subject: record.subject,
        status: record.status,
        ownerId: record.ownerId,
        documentRequestId: record.documentRequestId,
        slaDueAt: record.slaDueAt,
        slaHours: record.slaHours,
        createdBy: record.createdBy,
        turns: {
          create: {
            kind: record.openingTurn.kind,
            body: record.openingTurn.body,
            authorId: record.openingTurn.authorId,
            authorRole: record.openingTurn.authorRole,
            authorLabel: record.openingTurn.authorLabel,
          },
        },
      },
      include: withTurns,
    })) as unknown as ThreadRow;
    return toThread(row);
  },
  appendTurn: async (threadId: string, record: AppendTurnRecord) => {
    const row = (await db.rfiThread.update({
      where: { id: threadId },
      data: {
        status: record.nextStatus,
        slaDueAt:
          record.nextSlaDueAt === "UNCHANGED" ? undefined : record.nextSlaDueAt,
        turns: {
          create: {
            kind: record.kind,
            body: record.body,
            authorId: record.authorId,
            authorRole: record.authorRole,
            authorLabel: record.authorLabel,
          },
        },
      },
      include: withTurns,
    })) as unknown as ThreadRow;
    return toThread(row);
  },
  setStatus: async (
    threadId: string,
    status: RfiStatus,
    systemNote: string | null
  ) => {
    const row = (await db.rfiThread.update({
      where: { id: threadId },
      data: {
        status,
        turns: systemNote
          ? {
              create: {
                kind: "SYSTEM",
                body: systemNote,
                authorLabel: "system",
              },
            }
          : undefined,
      },
      include: withTurns,
    })) as unknown as ThreadRow;
    return toThread(row);
  },
  threadById: async (orgId: string, threadId: string) => {
    const row = (await db.rfiThread.findFirst({
      where: { id: threadId, orgId },
      include: withTurns,
    })) as unknown as ThreadRow | null;
    return row ? toThread(row) : null;
  },
  threadsForCase: async (orgId: string, caseId: string) => {
    const rows = (await db.rfiThread.findMany({
      where: { orgId, caseId },
      orderBy: { createdAt: "desc" },
      include: withTurns,
    })) as unknown as ThreadRow[];
    return rows.map(toThread);
  },
  overdueOpenThreads: async (now: Date, limit) => {
    const rows = (await db.rfiThread.findMany({
      where: { status: "OPEN", slaDueAt: { lte: now } },
      orderBy: { slaDueAt: "asc" },
      take: limit === undefined ? 50 : limit,
      include: withTurns,
    })) as unknown as ThreadRow[];
    return rows.map(toThread);
  },
};

const prismaRfiAudit: RfiAudit = {
  record: async (entry) => {
    await recordAudit({
      orgId: entry.orgId,
      actorId: entry.actorId,
      actorLabel: entry.actorLabel,
      action: entry.action,
      target: entry.target,
      reason: entry.reason,
      correlationId: entry.correlationId,
    });
  },
};

/** Composition root: bound use cases over the Prisma edge. */
export function rfiService(): RfiDeps {
  return { store: prismaRfiStore, audit: prismaRfiAudit };
}

export {
  appendRfiTurn,
  closeRfiThread,
  escalateOverdueThreads,
  escalateRfiThread,
  openRfiThread,
};
export type { RfiActor };
