/**
 * H2 adapter — Prisma-backed ScoreStore + audit sink (composition root lives
 * in the API route). Tenancy is explicit orgId scoping on every query.
 * Server-only. Row mapping is total: every PersistedScore field round-trips.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import type { Prisma } from "@/generated/prisma/client";
import type {
  PersistedScore,
  SaveScoreRecord,
  ScoreAudit,
  ScoreBand,
  ScoreDimensions,
  ScoreDeduction,
  ScoreStore,
} from "@/lib/ports/submission-readiness";

type ScoreRow = {
  id: string;
  orgId: string;
  caseId: string;
  programmeKey: string;
  computedScore: number;
  effectiveScore: number;
  band: string;
  dimensions: unknown;
  deductions: unknown;
  overridden: boolean;
  overrideNote: string | null;
  overrideBy: string | null;
  createdBy: string;
  createdAt: Date;
};

function toPersisted(r: ScoreRow): PersistedScore {
  return {
    id: r.id,
    orgId: r.orgId,
    caseId: r.caseId,
    programmeKey: r.programmeKey,
    computedScore: r.computedScore,
    effectiveScore: r.effectiveScore,
    band: r.band as ScoreBand,
    dimensions: r.dimensions as ScoreDimensions,
    deductions: r.deductions as ScoreDeduction[],
    overridden: r.overridden,
    overrideNote: r.overrideNote,
    overrideBy: r.overrideBy,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export const prismaScoreStore: ScoreStore = {
  async save(rec: SaveScoreRecord): Promise<PersistedScore> {
    const row = await db.submissionScore.create({
      data: {
        orgId: rec.orgId,
        caseId: rec.caseId,
        programmeKey: rec.programmeKey,
        computedScore: rec.computedScore,
        effectiveScore: rec.effectiveScore,
        band: rec.band,
        dimensions: rec.dimensions as unknown as Prisma.InputJsonValue,
        deductions: rec.deductions as unknown as Prisma.InputJsonValue,
        overridden: rec.overridden,
        overrideNote: rec.overrideNote,
        overrideBy: rec.overrideBy,
        createdBy: rec.createdBy,
      },
    });
    return toPersisted(row);
  },
  async listForCase(orgId: string, caseId: string): Promise<PersistedScore[]> {
    const rows = await db.submissionScore.findMany({
      where: { orgId, caseId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPersisted);
  },
};

/** ScoreAudit sink — every computation and override lands in the audit trail. */
export const scoreAuditSink: ScoreAudit = {
  async record(entry): Promise<void> {
    await audit({
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
