/**
 * H2 ports — submission-readiness score persistence and audit (ADR-004 strangler).
 *
 * The submission-readiness use cases (src/lib/services/submission-readiness.ts)
 * orchestrate against these contracts only. AI proposes flags (weak evidence,
 * inconsistencies); the pure scorer disposes — an AI suggestion never writes a
 * score directly. Fake-port unit tests inject the in-memory fake below (H3
 * offline default resolves to nothing).
 *
 * Structural types only: Prisma-free, safe to import anywhere.
 */

export type EvidenceTier = "VERIFIED" | "OBSERVED" | "UNKNOWN" | "NONE";

export type ScoreBand = "READY" | "CONDITIONAL" | "NOT_READY";

export type ScoreDimensionKey = "completeness" | "evidence" | "validity" | "consistency";

export interface ScoreDeduction {
  /** Stable machine code, e.g. "missing-doc:PASSPORT". */
  code: string;
  label: string;
  dimension: ScoreDimensionKey;
  /** Points lost off the 0-100 total (weight-apportioned, sums to 100 - score). */
  points: number;
  /** Human reason the RM reads before filing — the RFE-risk convention. */
  reason: string;
  /** Catalogue / document keys this deduction cites (eval-receipt pattern). */
  citations: string[];
}

export interface ScoreDimensions {
  completeness: number;
  evidence: number;
  validity: number;
  consistency: number;
}

export interface PersistedScore {
  id: string;
  orgId: string;
  caseId: string;
  programmeKey: string;
  computedScore: number;
  effectiveScore: number;
  band: ScoreBand;
  dimensions: ScoreDimensions;
  deductions: ScoreDeduction[];
  overridden: boolean;
  overrideNote: string | null;
  overrideBy: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface SaveScoreRecord {
  orgId: string;
  caseId: string;
  programmeKey: string;
  computedScore: number;
  effectiveScore: number;
  band: ScoreBand;
  dimensions: ScoreDimensions;
  deductions: ScoreDeduction[];
  overridden: boolean;
  overrideNote: string | null;
  overrideBy: string | null;
  createdBy: string;
}

export interface ScoreStore {
  save(record: SaveScoreRecord): Promise<PersistedScore>;
  listForCase(orgId: string, caseId: string): Promise<PersistedScore[]>;
}

/** Audit sink — every computed score and every override lands here. */
export interface ScoreAudit {
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

/** H3 offline default — resolves to nothing, so no score persists offline. */
export const offlineScoreStore: ScoreStore = {
  save: async () => null as never,
  listForCase: async () => [],
};

export interface FakeScoreStore extends ScoreStore {
  rows: Map<string, PersistedScore[]>;
}

/** In-memory fake for unit specs — deterministic, no clock surprises. */
export function createFakeScoreStore(seed: PersistedScore[] = []): FakeScoreStore {
  const rows = new Map<string, PersistedScore[]>();
  for (const s of seed) {
    const key = s.orgId + "/" + s.caseId;
    const list = rows.get(key) ?? [];
    list.push(structuredClone(s));
    rows.set(key, list);
  }
  let seq = seed.length;
  const clone = (s: PersistedScore): PersistedScore => structuredClone(s);
  return {
    rows,
    save: async (record) => {
      seq += 1;
      const row: PersistedScore = {
        id: "score_" + String(seq).padStart(4, "0"),
        orgId: record.orgId,
        caseId: record.caseId,
        programmeKey: record.programmeKey,
        computedScore: record.computedScore,
        effectiveScore: record.effectiveScore,
        band: record.band,
        dimensions: { ...record.dimensions },
        deductions: record.deductions.map((d) => ({ ...d, citations: [...d.citations] })),
        overridden: record.overridden,
        overrideNote: record.overrideNote,
        overrideBy: record.overrideBy,
        createdBy: record.createdBy,
        createdAt: new Date(),
      };
      const key = row.orgId + "/" + row.caseId;
      const list = rows.get(key) ?? [];
      list.push(row);
      rows.set(key, list);
      return clone(row);
    },
    listForCase: async (orgId, caseId) =>
      (rows.get(orgId + "/" + caseId) ?? []).map(clone),
  };
}

export interface FakeScoreAudit extends ScoreAudit {
  entries: Array<{ action: string; target: string; reason?: string }>;
}

/** In-memory audit sink for specs — asserts every score/override was logged. */
export function createFakeScoreAudit(): FakeScoreAudit {
  const entries: Array<{ action: string; target: string; reason?: string }> = [];
  return {
    entries,
    record: async (entry) => {
      entries.push({ action: entry.action, target: entry.target, reason: entry.reason });
    },
  };
}
