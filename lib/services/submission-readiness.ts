/**
 * Submission-readiness score — the desk's pre-filing RFE-risk scan.
 *
 * Per-case AI-assisted score over four dimensions (document completeness,
 * evidence strength, expiry/validity, inconsistency flags). AI proposes flags;
 * this module disposes: scoreSubmission() is a pure, deterministic function of
 * its input, so the same evidence always yields the same score and every point
 * lost carries a cited reason (eval-receipt pattern). RM override + audit and
 * score history are orchestrated over the injected ScoreStore/ScoreAudit ports
 * (ADR-004) — routes supply the Prisma-backed store; specs inject the fake.
 *
 * Prisma-free and side-effect-free except through the injected ports.
 */
import { programmeByKey } from "@/lib/domain/programmes";
import { DomainError } from "@/lib/domain/states";
import type {
  EvidenceTier,
  PersistedScore,
  ScoreAudit,
  ScoreBand,
  ScoreDeduction,
  ScoreDimensionKey,
  ScoreDimensions,
  ScoreStore,
} from "@/lib/ports/submission-readiness";

export type DocStatus = "CURRENT" | "MISSING" | "EXPIRED" | "EXPIRING_SOON";

export interface ScoreDocEvidence {
  /** Canonical or legacy document key (resolved via canonicalDocumentKey). */
  key: string;
  status: DocStatus;
  /** C1 evidence tier for the held copy; NONE = asserted but unevidenced. */
  evidence: EvidenceTier;
  /** AI / desk note for why the evidence is weak (cited into the deduction). */
  weakReason?: string;
}

export interface ScoreInconsistency {
  key: string;
  label: string;
  detail: string;
  severity: "BLOCKER" | "REVIEW";
}

export interface SubmissionScoreInput {
  programmeKey: string;
  documents: ReadonlyArray<ScoreDocEvidence>;
  screeningDone?: ReadonlyArray<string | null | undefined>;
  sofSubmitted?: boolean;
  sofHasEvidence?: boolean;
  /** AI-assisted flags: cross-field / cross-document contradictions. */
  inconsistencies?: ReadonlyArray<ScoreInconsistency>;
}

export interface SubmissionScore {
  programmeKey: string;
  programmeLabel: string;
  /** Weighted 0-100 total. */
  score: number;
  band: ScoreBand;
  dimensions: ScoreDimensions;
  /** Every point lost, with a cited reason (sums to 100 - score, ±1 rounding). */
  deductions: ScoreDeduction[];
  /** Whether the desk may file on this score (band READY). */
  filingReady: boolean;
  receipt: string;
}

const WEIGHTS: Record<ScoreDimensionKey, number> = {
  completeness: 0.35,
  evidence: 0.25,
  validity: 0.2,
  consistency: 0.2,
};

const EVIDENCE_POINTS: Record<EvidenceTier, number> = {
  VERIFIED: 100,
  OBSERVED: 70,
  UNKNOWN: 40,
  NONE: 20,
};

function evidencePoints(tier: EvidenceTier): number {
  // Runtime guard: an unvalidated tier must never NaN the weighted total.
  return EVIDENCE_POINTS[tier] ?? EVIDENCE_POINTS.UNKNOWN;
}

export const FILING_THRESHOLD = 80;
export const CONDITIONAL_THRESHOLD = 60;

export function bandFor(score: number): ScoreBand {
  if (score >= FILING_THRESHOLD) return "READY";
  if (score >= CONDITIONAL_THRESHOLD) return "CONDITIONAL";
  return "NOT_READY";
}

/** One-line human rendering for the RM desk and audit trails (receipt pattern). */
export function formatScoreReceipt(
  s: Pick<SubmissionScore, "score" | "band" | "programmeKey" | "deductions">
): string {
  const top = s.deductions
    .slice()
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((d) => d.code + "(-" + d.points + ")")
    .join(" ");
  return (
    s.band +
    " " +
    s.score +
    "/100 · " +
    s.programmeKey +
    (top ? " · " + top : " · no deductions")
  );
}

import { canonicalDocumentKey } from "@/lib/domain/lifecycle";

function pointsFor(
  dimension: ScoreDimensionKey,
  dimensionPointsLost: number
): number {
  return Math.round(dimensionPointsLost * WEIGHTS[dimension] * 10) / 10;
}

/**
 * Pure deterministic scorer. Unknown programme → NOT_READY with a single
 * cited deduction (never throws on data the desk has not curated yet).
 */
export function scoreSubmission(input: SubmissionScoreInput): SubmissionScore {
  const programme = programmeByKey(input.programmeKey);
  if (!programme) {
    const deductions: ScoreDeduction[] = [
      {
        code: "unknown-programme",
        label: "Unknown programme",
        dimension: "completeness",
        points: 100,
        reason:
          "Programme '" +
          input.programmeKey +
          "' is not in the catalogue — nothing to score against.",
        citations: [input.programmeKey],
      },
    ];
    const score = 0;
    const band = bandFor(score);
    const out: SubmissionScore = {
      programmeKey: input.programmeKey,
      programmeLabel: input.programmeKey,
      score,
      band,
      dimensions: { completeness: 0, evidence: 0, validity: 0, consistency: 0 },
      deductions,
      filingReady: false,
      receipt: "",
    };
    out.receipt = formatScoreReceipt(out);
    return out;
  }

  const required = programme.requirements.map((k) => canonicalDocumentKey(k));
  const byKey = new Map<string, ScoreDocEvidence>();
  for (const d of input.documents) {
    const key = canonicalDocumentKey(d.key);
    if (!byKey.has(key)) byKey.set(key, { ...d, key });
  }

  const screeningDone = new Set(
    (input.screeningDone ?? []).filter((k): k is string => Boolean(k))
  );
  const needsSof = required.includes("SOURCE_OF_FUNDS_EVIDENCE");
  const inconsistencies = [...(input.inconsistencies ?? [])];

  const deductions: ScoreDeduction[] = [];

  // ── Completeness: required docs + screening + SOF as scoring units ──
  const screeningTotal = programme.screening.length;
  const screeningDoneCount = programme.screening.filter((k) =>
    screeningDone.has(k)
  ).length;
  const sofTotal = needsSof ? 1 : 0;
  const sofDone = needsSof && input.sofSubmitted ? 1 : 0;
  // EXPIRING_SOON still counts as collected (validity prices the staleness);
  // EXPIRED counts as undone — the copy must be renewed like a missing one.
  const docsDone = required.filter((k) => {
    const st = byKey.get(k)?.status;
    return st === "CURRENT" || st === "EXPIRING_SOON";
  }).length;
  const totalUnits = required.length + screeningTotal + sofTotal;
  const doneUnits = docsDone + screeningDoneCount + sofDone;
  const completeness =
    totalUnits === 0 ? 100 : Math.round((doneUnits / totalUnits) * 100);

  for (const key of required) {
    const doc = byKey.get(key);
    if (!doc || doc.status === "MISSING") {
      deductions.push({
        code: "missing-doc:" + key,
        label: "Missing " + key,
        dimension: "completeness",
        points: 0, // apportioned below
        reason:
          "Required document '" + key + "' has no collected copy on the case.",
        citations: [key, programme.key],
      });
    } else if (doc.status === "EXPIRED") {
      deductions.push({
        code: "renew-doc:" + key,
        label: "Renew " + key,
        dimension: "completeness",
        points: 0, // apportioned below
        reason:
          "Required document '" +
          key +
          "' is expired — a current copy must be collected before filing.",
        citations: [key, programme.key],
      });
    }
  }
  for (const key of programme.screening) {
    if (!screeningDone.has(key)) {
      deductions.push({
        code: "missing-screening:" + key,
        label: "Screening not recorded: " + key,
        dimension: "completeness",
        points: 0,
        reason:
          "Screening check '" +
          key +
          "' is required for " +
          programme.label +
          " but has no recorded result.",
        citations: [key, programme.key],
      });
    }
  }
  if (needsSof && !input.sofSubmitted) {
    deductions.push({
      code: "missing-sof",
      label: "Source-of-funds declaration missing",
      dimension: "completeness",
      points: 0,
      reason:
        "A source-of-funds declaration is required but was never submitted.",
      citations: ["SOURCE_OF_FUNDS_EVIDENCE", programme.key],
    });
  }
  // Apportion completeness points evenly across completeness deductions.
  const completenessUnits = deductions.filter(
    (d) => d.dimension === "completeness"
  ).length;
  const completenessLost = 100 - completeness;
  if (completenessUnits > 0) {
    const each =
      Math.floor(
        (pointsFor("completeness", completenessLost) * 10) / completenessUnits
      ) / 10;
    let assigned = 0;
    const comp = deductions.filter((d) => d.dimension === "completeness");
    comp.forEach((d, i) => {
      d.points =
        i === comp.length - 1
          ? Math.round(
              (pointsFor("completeness", completenessLost) - assigned) * 10
            ) / 10
          : each;
      assigned = Math.round((assigned + each) * 10) / 10;
    });
  }

  // ── Evidence strength: average tier over held current copies ──
  const held = required
    .map((k) => byKey.get(k))
    .filter(
      (d): d is ScoreDocEvidence =>
        !!d && (d.status === "CURRENT" || d.status === "EXPIRING_SOON")
    );
  const evidence =
    held.length === 0
      ? required.length === 0
        ? 100
        : 0
      : Math.round(
          held.reduce((sum, d) => sum + evidencePoints(d.evidence), 0) /
            held.length
        );
  for (const doc of held) {
    if (doc.evidence === "VERIFIED") continue;
    const tierNote =
      doc.evidence === "NONE"
        ? "asserted but unevidenced"
        : "tier " + doc.evidence;
    deductions.push({
      code: "weak-evidence:" + doc.key,
      label: "Weak evidence: " + doc.key,
      dimension: "evidence",
      points: pointsFor(
        "evidence",
        (100 - evidencePoints(doc.evidence)) / held.length
      ),
      reason:
        "'" +
        doc.key +
        "' is held but " +
        tierNote +
        (doc.weakReason ? " — " + doc.weakReason : "") +
        " (RFE risk: the authority re-asks for what is not verified).",
      citations: [doc.key, programme.key],
    });
  }
  if (needsSof && input.sofSubmitted && !input.sofHasEvidence) {
    deductions.push({
      code: "weak-evidence:SOURCE_OF_FUNDS_EVIDENCE",
      label: "SOF submitted without evidence links",
      dimension: "evidence",
      points: pointsFor("evidence", 30 / Math.max(held.length + 1, 1)),
      reason:
        "The source-of-funds declaration was submitted with no evidence links attached.",
      citations: ["SOURCE_OF_FUNDS_EVIDENCE", programme.key],
    });
  }

  // ── Validity: expired and expiring-soon copies ──
  const expiredCount = required.filter(
    (k) => byKey.get(k)?.status === "EXPIRED"
  ).length;
  const expiringCount = required.filter(
    (k) => byKey.get(k)?.status === "EXPIRING_SOON"
  ).length;
  const validity = Math.max(0, 100 - expiredCount * 25 - expiringCount * 10);
  for (const key of required) {
    const doc = byKey.get(key);
    if (doc?.status === "EXPIRED") {
      deductions.push({
        code: "expired-doc:" + key,
        label: "Expired " + key,
        dimension: "validity",
        points: pointsFor("validity", 25),
        reason:
          "'" +
          key +
          "' is past its validity window and must be renewed before filing (cf. 90-day police rule).",
        citations: [key, programme.key],
      });
    } else if (doc?.status === "EXPIRING_SOON") {
      deductions.push({
        code: "expiring-doc:" + key,
        label: "Expiring soon: " + key,
        dimension: "validity",
        points: pointsFor("validity", 10),
        reason:
          "'" +
          key +
          "' expires within the filing window — renew in parallel or the file goes stale.",
        citations: [key, programme.key],
      });
    }
  }

  // ── Consistency: AI/desk inconsistency flags ──
  const blockers = inconsistencies.filter(
    (f) => f.severity === "BLOCKER"
  ).length;
  const reviews = inconsistencies.filter((f) => f.severity === "REVIEW").length;
  const consistency = Math.max(0, 100 - blockers * 25 - reviews * 10);
  for (const flag of inconsistencies) {
    deductions.push({
      code: "inconsistency:" + flag.key,
      label: flag.label,
      dimension: "consistency",
      points: pointsFor("consistency", flag.severity === "BLOCKER" ? 25 : 10),
      reason: flag.detail,
      citations: [flag.key, programme.key],
    });
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        completeness * WEIGHTS.completeness +
          evidence * WEIGHTS.evidence +
          validity * WEIGHTS.validity +
          consistency * WEIGHTS.consistency
      )
    )
  );
  const band = bandFor(score);
  const ordered = deductions.sort(
    (a, b) => b.points - a.points || (a.code < b.code ? -1 : 1)
  );
  const out: SubmissionScore = {
    programmeKey: programme.key,
    programmeLabel: programme.label,
    score,
    band,
    dimensions: { completeness, evidence, validity, consistency },
    deductions: ordered,
    filingReady: band === "READY",
    receipt: "",
  };
  out.receipt = formatScoreReceipt(out);
  return out;
}

// ── Orchestration over ports ──

export type ScoreActor = { id: string; role: string; label: string };
export type ScoreCaseContext = { id: string; orgId: string };
export type ScoreDeps = { store: ScoreStore; audit: ScoreAudit };

const OVERRIDE_ROLES = new Set(["RM", "SENIOR_RM", "ADMIN"]);

function auditTarget(caseId: string, scoreId: string): string {
  return "case:" + caseId + "/score:" + scoreId;
}

/** Compute + persist a score; every computation leaves an audit row (C11). */
export async function recordSubmissionScore(
  deps: ScoreDeps,
  kase: ScoreCaseContext,
  actor: ScoreActor,
  input: SubmissionScoreInput,
  correlationId?: string
): Promise<PersistedScore> {
  const computed = scoreSubmission(input);
  const row = await deps.store.save({
    orgId: kase.orgId,
    caseId: kase.id,
    programmeKey: computed.programmeKey,
    computedScore: computed.score,
    effectiveScore: computed.score,
    band: computed.band,
    dimensions: computed.dimensions,
    deductions: computed.deductions,
    overridden: false,
    overrideNote: null,
    overrideBy: null,
    createdBy: actor.id,
  });
  await deps.audit.record({
    orgId: kase.orgId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: "submission.score.recorded",
    target: auditTarget(kase.id, row.id),
    reason: computed.receipt,
    correlationId,
  });
  return row;
}

function assertCanOverride(actor: ScoreActor): void {
  if (!OVERRIDE_ROLES.has(actor.role.toUpperCase())) {
    throw new DomainError(
      "Only the RM desk (RM, SENIOR_RM, ADMIN) may override a score",
      403
    );
  }
}

/**
 * RM override (R5 four-eyes spirit): desk roles only, note required, and the
 * override is a NEW history row — the computed score is never rewritten.
 */
export async function overrideSubmissionScore(
  deps: ScoreDeps,
  kase: ScoreCaseContext,
  actor: ScoreActor,
  input: { base: PersistedScore; effectiveScore: number; note: string },
  correlationId?: string
): Promise<PersistedScore> {
  assertCanOverride(actor);
  const note = input.note.trim();
  if (note.length < 10)
    throw new DomainError(
      "Override needs a note of at least 10 characters",
      400
    );
  if (
    !Number.isFinite(input.effectiveScore) ||
    input.effectiveScore < 0 ||
    input.effectiveScore > 100
  ) {
    throw new DomainError("Override score must be between 0 and 100", 400);
  }
  if (input.base.orgId !== kase.orgId || input.base.caseId !== kase.id) {
    throw new DomainError("Score does not belong to this case", 404);
  }
  const effective = Math.round(input.effectiveScore);
  const row = await deps.store.save({
    orgId: kase.orgId,
    caseId: kase.id,
    programmeKey: input.base.programmeKey,
    computedScore: input.base.computedScore,
    effectiveScore: effective,
    band: bandFor(effective),
    dimensions: input.base.dimensions,
    deductions: input.base.deductions,
    overridden: true,
    overrideNote: note,
    overrideBy: actor.label,
    createdBy: actor.id,
  });
  await deps.audit.record({
    orgId: kase.orgId,
    actorId: actor.id,
    actorLabel: actor.label,
    action: "submission.score.overridden",
    target: auditTarget(kase.id, row.id),
    reason:
      "computed " +
      input.base.computedScore +
      " → effective " +
      effective +
      ": " +
      note,
    correlationId,
  });
  return row;
}

/** Score history for a case — newest first. */
export async function scoreHistory(
  deps: ScoreDeps,
  kase: ScoreCaseContext
): Promise<PersistedScore[]> {
  const rows = await deps.store.listForCase(kase.orgId, kase.id);
  return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
