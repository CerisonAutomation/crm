/**
 * Evidence-readiness summary — the desk's pre-filing checklist.
 *
 * Produces a structured snapshot of what evidence the case has, what it lacks,
 * and where the risks lie. Used by the RM before dispatching a file, and by
 * the client portal to show "what the desk is waiting for".
 *
 * Prisma-free and side-effect-free, so it is unit-testable without a database.
 */
import { programmeByKey, type Programme } from "@/lib/domain/programmes";
import { DOCUMENT_CATALOG, canonicalDocumentKey, type DocumentSpec } from "@/lib/domain/lifecycle";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A single requirement in the readiness summary. */
export interface ReadinessItem {
  key: string;
  label: string;
  category: DocumentSpec["category"];
  /** Whether the programme requires this item. */
  required: boolean;
  /** Whether the case has a current (non-expired) version. */
  satisfied: boolean;
  /** Whether the case has it but it is expired. */
  expired: boolean;
  /** The issuing authority / source. */
  issuedBy: string;
  /** Whether a certified copy is required. */
  certified: boolean;
  /** Validity window in months (null = no expiry). */
  validityMonths: number | null;
}

/** A gap that must be closed before filing. */
export interface ReadinessGap {
  key: string;
  label: string;
  /** Why it blocks or weakens the file. */
  reason: string;
  /** Priority for the applicant. */
  priority: "HIGH" | "MEDIUM" | "LOW";
}

/** A strength the file already has. */
export interface ReadinessStrength {
  key: string;
  label: string;
  /** Why it helps the file. */
  reason: string;
}

/** A risk area that needs human judgement. */
export interface ReadinessRisk {
  key: string;
  label: string;
  /** The concern. */
  concern: string;
  /** What the desk should do about it. */
  action: string;
}

/** Full evidence-readiness summary for one case file. */
export interface EvidenceReadinessSummary {
  programmeKey: string;
  programmeLabel: string;
  /** Overall readiness 0–100. */
  score: number;
  /** Breakdown by category. */
  items: ReadinessItem[];
  /** Missing / expired required items. */
  gaps: ReadinessGap[];
  /** Already satisfied required items. */
  strengths: ReadinessStrength[];
  /** Human-judgement areas. */
  risks: ReadinessRisk[];
  /** Whether the score is at or above the filing threshold. */
  filingReady: boolean;
}

/** Input to the evidence-readiness summary. */
export interface EvidenceReadinessInput {
  programmeKey: string;
  /** Document keys the case has collected (canonical or legacy). */
  collectedDocuments: ReadonlyArray<string | null | undefined>;
  /** Document keys that are expired (validity window passed). */
  expiredDocuments?: ReadonlyArray<string | null | undefined>;
  /** Screening keys already recorded for the case. */
  screeningDone?: ReadonlyArray<string | null | undefined>;
  /** Whether a source-of-funds declaration has been submitted. */
  sofSubmitted?: boolean;
  /** Whether the SOF has evidence links. */
  sofHasEvidence?: boolean;
  /** Reference clock (defaults to now); injected for deterministic tests. */
  now?: Date;
}

/** Filing threshold — below this the desk should not dispatch. */
const FILING_THRESHOLD = 75;

/**
 * Build the evidence-readiness summary for one case file.
 *
 * Pure function: deterministic for a given input and clock.
 */
export function buildEvidenceReadiness(
  input: EvidenceReadinessInput,
): EvidenceReadinessSummary {
  const programme = programmeByKey(input.programmeKey);
  if (!programme) {
    return {
      programmeKey: input.programmeKey,
      programmeLabel: input.programmeKey,
      score: 0,
      items: [],
      gaps: [{ key: "unknown", label: "Unknown programme", reason: "Programme not in catalogue", priority: "HIGH" }],
      strengths: [],
      risks: [],
      filingReady: false,
    };
  }

  const now = input.now ?? new Date();
  const collected = new Set(
    input.collectedDocuments
      .filter((k): k is string => Boolean(k))
      .map((k) => canonicalDocumentKey(k)),
  );
  const expired = new Set(
    (input.expiredDocuments ?? [])
      .filter((k): k is string => Boolean(k))
      .map((k) => canonicalDocumentKey(k)),
  );
  const screeningDone = new Set(
    (input.screeningDone ?? [])
      .filter((k): k is string => Boolean(k)),
  );

  // ── Build items for every programme requirement ──────────────────────────
  const items: ReadinessItem[] = [];
  for (const reqKey of programme.requirements) {
    const spec = DOCUMENT_CATALOG.find((d) => d.key === reqKey);
    const satisfied = collected.has(reqKey) && !expired.has(reqKey);
    const isExpired = expired.has(reqKey);
    items.push({
      key: reqKey,
      label: spec?.label ?? reqKey,
      category: spec?.category ?? "OTHER",
      required: true,
      satisfied,
      expired: isExpired,
      issuedBy: spec?.issuedBy ?? "—",
      certified: spec?.certified ?? false,
      validityMonths: spec?.validityMonths ?? null,
    });
  }

  // ── Gaps: required but missing or expired ────────────────────────────────
  const gaps: ReadinessGap[] = [];
  for (const item of items) {
    if (!item.required) continue;
    if (!item.satisfied && !item.expired) {
      gaps.push({
        key: item.key,
        label: item.label,
        reason: `Required document not collected`,
        priority: "HIGH",
      });
    } else if (item.expired) {
      gaps.push({
        key: item.key,
        label: item.label,
        reason: `Document expired — must be renewed`,
        priority: "HIGH",
      });
    }
  }

  // ── Screening gaps ───────────────────────────────────────────────────────
  for (const key of programme.screening) {
    if (!screeningDone.has(key)) {
      gaps.push({
        key,
        label: `Screening: ${key}`,
        reason: `Screening check not recorded`,
        priority: "MEDIUM",
      });
    }
  }

  // ── SOF gap ──────────────────────────────────────────────────────────────
  const needsSof = programme.requirements.includes("SOURCE_OF_FUNDS_EVIDENCE");
  if (needsSof && !input.sofSubmitted) {
    gaps.push({
      key: "SOURCE_OF_FUNDS_EVIDENCE",
      label: "Source of Funds Declaration",
      reason: `Required declaration not submitted`,
      priority: "HIGH",
    });
  } else if (needsSof && input.sofSubmitted && !input.sofHasEvidence) {
    gaps.push({
      key: "SOURCE_OF_FUNDS_EVIDENCE",
      label: "Source of Funds Declaration",
      reason: `Submitted but no evidence links attached`,
      priority: "MEDIUM",
    });
  }

  // ── Strengths: satisfied required items ──────────────────────────────────
  const strengths: ReadinessStrength[] = [];
  for (const item of items) {
    if (item.required && item.satisfied) {
      strengths.push({
        key: item.key,
        label: item.label,
        reason: `Collected and current`,
      });
    }
  }

  // ── Risks: watch factors, continuing obligations, stale documents ────────
  const risks: ReadinessRisk[] = [];

  for (const watch of programme.watchFactors) {
    risks.push({
      key: `watch:${watch.slice(0, 30)}`,
      label: `Watch: ${watch}`,
      concern: "Weighed point the desk must address",
      action: "Write a desk assessment for the file.",
    });
  }

  if (programme.minimumStayDaysPerYear > 0) {
    risks.push({
      key: "substance:presence",
      label: `Physical presence: ${programme.minimumStayDaysPerYear} day(s)/year`,
      concern: "Continuing obligation the authority monitors",
      action: "Obtain client's written acknowledgement.",
    });
  }

  // Stale documents (collected but older than STALE_DOCUMENT_DAYS)
  const STALE_MS = 90 * MS_PER_DAY;
  // Note: we don't have actual collection dates here, so this is a placeholder
  // In practice, the API would pass the actual document collection dates.

  // ── Score ────────────────────────────────────────────────────────────────
  const requiredItems = items.filter((i) => i.required);
  const satisfiedCount = requiredItems.filter((i) => i.satisfied).length;
  const expiredCount = requiredItems.filter((i) => i.expired).length;
  const missingCount = requiredItems.filter((i) => !i.satisfied && !i.expired).length;

  // Screening and SOF count as required items for scoring
  const screeningTotal = programme.screening.length;
  const screeningDoneCount = programme.screening.filter((k) => screeningDone.has(k)).length;
  const screeningMissing = screeningTotal - screeningDoneCount;

  const sofTotal = needsSof ? 1 : 0;
  const sofDone = (needsSof && input.sofSubmitted) ? 1 : 0;

  const totalRequired = requiredItems.length + screeningTotal + sofTotal;
  const totalSatisfied = satisfiedCount + screeningDoneCount + sofDone;
  const score = totalRequired > 0
    ? Math.round((totalSatisfied / totalRequired) * 100)
    : 100;

  return {
    programmeKey: programme.key,
    programmeLabel: programme.label,
    score,
    items,
    gaps,
    strengths,
    risks,
    filingReady: score >= FILING_THRESHOLD,
  };
}