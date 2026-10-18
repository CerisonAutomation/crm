/**
 * Adversarial pre-filing review — the desk's devil's advocate.
 *
 * Before a file is dispatched to the authority, this service re-projects the
 * evidence collected so far and argues AGAINST approval. It is deliberately
 * sceptical: it assumes the authority will challenge every weak point, and it
 * surfaces those points as structured grounds the RM must rebut one by one.
 *
 * This is NOT a decision — it is a review aid. The human decides. But a file
 * that has survived an adversarial review is far less likely to be refused,
 * and the review produces a concrete list of what to fix before filing.
 *
 * Prisma-free and side-effect-free, so it is unit-testable without a database.
 */
import { programmeByKey, type Programme } from "@/lib/domain/programmes";
import { DOCUMENT_CATALOG, canonicalDocumentKey, type DocumentSpec } from "@/lib/domain/lifecycle";

/** Severity of an adversarial finding. */
export type AdversarialSeverity = "BLOCKER" | "MATERIAL" | "MINOR";

/** One ground the authority could refuse the file. */
export interface AdversarialGround {
  /** Stable id — safe to key a stored rebuttal on. */
  id: string;
  /** Category of the ground. */
  kind: "missing_document" | "expired_document" | "unaddressed_watch" | "screening_gap" | "sof_gap" | "rule_risk" | "substance_risk";
  severity: AdversarialSeverity;
  /** The challenge, stated as the authority would raise it. */
  challenge: string;
  /** What would answer it. */
  rebuttal: string;
  /** Where the ground comes from. */
  provenance: string;
}

/** The full adversarial review for one case file. */
export interface AdversarialReview {
  programmeKey: string;
  programmeLabel: string;
  /** The one-line thesis — why this file may be refused as it stands. */
  thesis: string;
  grounds: AdversarialGround[];
  /** True when nothing could be argued — which is NOT an approval. */
  insufficientBasis: boolean;
  /** Requirement keys the applicant should produce to answer the open grounds. */
  toRequest: string[];
  /** Overall readiness score 0–100 (100 = no grounds). */
  readinessScore: number;
}

/** Input to the adversarial review. */
export interface AdversarialReviewInput {
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

/** Days after which a document is considered stale even if not expired. */
const STALE_DOCUMENT_DAYS = 90;
const MS_PER_DAY = 86_400_000;

/**
 * Compute which documents for a case are expired against their programme
 * version's DocExpiryPolicy. Returns canonical document keys.
 *
 * A document is expired when:
 * - It has an `expiresAt` set that is in the past, OR
 * - Its programme version has a DocExpiryPolicy for its type with a `validDays`
 *   window and the document's `createdAt` is older than that window.
 *
 * This is the server-side half of the adversarial review — the pure review
 * engine takes the computed set as input so it stays deterministic and
 * unit-testable.
 */
export async function computeExpiredDocuments(
  db: {
    document: {
      findMany: (args: { where: { caseId: string }; select: { type: true; createdAt: true; expiresAt: true } }) => Promise<Array<{ type: string; createdAt: Date; expiresAt: Date | null }>>;
    };
    case: {
      findUnique: (args: { where: { id: string }; select: { programmeId: true } }) => Promise<{ programmeId: string | null } | null>;
    };
    programVersion: {
          findMany: (args: { where: { programmeId: string }; select: { id: true } }) => Promise<Array<{ id: string }>>;
        };
    docExpiryPolicy: {
      findMany: (args: { where: { programVersionId: { in: string[] } }; select: { docType: true; validDays: true } }) => Promise<Array<{ docType: string; validDays: number }>>;
    };
  },
  caseId: string,
): Promise<string[]> {
  const docs = await db.document.findMany({
    where: { caseId },
    select: { type: true, createdAt: true, expiresAt: true },
  });

  const expired: string[] = [];
  const now = new Date();

  // Check explicit expiresAt first
  for (const doc of docs) {
    if (doc.expiresAt && new Date(doc.expiresAt) < now) {
      expired.push(doc.type);
    }
  }

  // Check DocExpiryPolicy windows — find the case's programme version
  const c = await db.case.findUnique({
    where: { id: caseId },
    select: { programmeId: true },
  });

  if (c?.programmeId) {
    const versions = await db.programVersion.findMany({
      where: { programmeId: c.programmeId },
      select: { id: true },
    });

    if (versions.length > 0) {
      const policies = await db.docExpiryPolicy.findMany({
        where: { programVersionId: { in: versions.map((v) => v.id) } },
        select: { docType: true, validDays: true },
      });

      const policyMap = new Map<string, number>(
        policies.map((p) => [p.docType, p.validDays]),
      );

      for (const doc of docs) {
        const validDays = policyMap.get(doc.type);
        if (validDays && validDays > 0) {
          const windowEnd = new Date(doc.createdAt);
          windowEnd.setDate(windowEnd.getDate() + validDays);
          if (windowEnd < now && !expired.includes(doc.type)) {
            expired.push(doc.type);
          }
        }
      }
    }
  }

  return expired;
}

/** Map a document key to its catalogued spec, or null if unknown. */
function docSpec(key: string): DocumentSpec | null {
  const canonical = canonicalDocumentKey(key);
  return DOCUMENT_CATALOG.find((d) => d.key === canonical) ?? null;
}

/** True when a document key resolves to a real catalogued document. */
function isKnownDocument(key: string): boolean {
  return docSpec(key) !== null;
}

/**
 * Build the adversarial review for one case file.
 *
 * Grounds are derived from the programme's requirements, watch factors, and
 * screening set, cross-referenced against what the case has actually
 * collected. Deterministic for a given input and clock.
 */
export function buildAdversarialReview(
  input: AdversarialReviewInput,
): AdversarialReview {
  const programme = programmeByKey(input.programmeKey);
  if (!programme) {
    return {
      programmeKey: input.programmeKey,
      programmeLabel: input.programmeKey,
      thesis: "Unknown programme — cannot review.",
      grounds: [{
        id: "unknown_programme",
        kind: "rule_risk",
        severity: "BLOCKER",
        challenge: `Programme "${input.programmeKey}" is not in the catalogue.`,
        rebuttal: "Select a valid programme before filing.",
        provenance: "catalogue",
      }],
      insufficientBasis: false,
      toRequest: [],
      readinessScore: 0,
    };
  }

  const grounds: AdversarialGround[] = [];
  const now = input.now ?? new Date();

  // ── Missing documents ─────────────────────────────────────────────────────
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

  for (const reqKey of programme.requirements) {
    if (!collected.has(reqKey)) {
      const spec = docSpec(reqKey);
      grounds.push({
        id: `missing:${reqKey}`,
        kind: "missing_document",
        severity: "BLOCKER",
        challenge: `Required document "${spec?.label ?? reqKey}" has not been collected.`,
        rebuttal: `Collect and upload ${spec?.label ?? reqKey}.`,
        provenance: `requirement:${reqKey}`,
      });
    } else if (expired.has(reqKey)) {
      const spec = docSpec(reqKey);
      grounds.push({
        id: `expired:${reqKey}`,
        kind: "expired_document",
        severity: "MATERIAL",
        challenge: `Document "${spec?.label ?? reqKey}" is past its validity window.`,
        rebuttal: `Obtain a fresh ${spec?.label ?? reqKey}.`,
        provenance: `validity:${reqKey}`,
      });
    }
  }

  // ── Unaddressed watch factors ─────────────────────────────────────────────
  for (const watch of programme.watchFactors) {
    grounds.push({
      id: `watch:${watch.slice(0, 30)}`,
      kind: "unaddressed_watch",
      severity: "MATERIAL",
      challenge: `Unaddressed weighed point: ${watch}`,
      rebuttal: "A written assessment of this point for the file, signed off by the desk.",
      provenance: "watchFactor",
    });
  }

  // ── Screening gaps ────────────────────────────────────────────────────────
  if (input.screeningDone) {
    const done = new Set(
      input.screeningDone.filter((k): k is string => Boolean(k)),
    );
    for (const key of programme.screening) {
      if (!done.has(key)) {
        grounds.push({
          id: `screening:${key}`,
          kind: "screening_gap",
          severity: "MATERIAL",
          challenge: `Screening check "${key}" has not been recorded.`,
          rebuttal: `Run and record screening "${key}".`,
          provenance: `screening:${key}`,
        });
      }
    }
  }

  // ── Source of funds ───────────────────────────────────────────────────────
  const needsSof = programme.requirements.includes("SOURCE_OF_FUNDS_EVIDENCE");
  if (needsSof && !input.sofSubmitted) {
    grounds.push({
      id: "sof:missing",
      kind: "sof_gap",
      severity: "BLOCKER",
      challenge: "No source-of-funds declaration has been submitted.",
      rebuttal: "Submit the source-of-funds questionnaire with evidence links.",
      provenance: "requirement:SOURCE_OF_FUNDS_EVIDENCE",
    });
  } else if (needsSof && input.sofSubmitted && !input.sofHasEvidence) {
    grounds.push({
      id: "sof:no_evidence",
      kind: "sof_gap",
      severity: "MATERIAL",
      challenge: "Source-of-funds declaration has no evidence links.",
      rebuttal: "Attach bank statements, contracts, or other proof of lawful source.",
      provenance: "requirement:SOURCE_OF_FUNDS_EVIDENCE",
    });
  }

  // ── Rule risks ───────────────────────────────────────────────────────────
  for (const rule of programme.eligibility) {
    if (rule.rule === "must_not_work" && rule.value) {
      grounds.push({
        id: "rule:employment",
        kind: "rule_risk",
        severity: "MATERIAL",
        challenge: "This route prohibits gainful employment — the authority will test this.",
        rebuttal: "The client's written acknowledgement that they will not work.",
        provenance: "rule:must_not_work",
      });
    }
    if (rule.rule === "residence_years_min") {
      grounds.push({
        id: "rule:residence",
        kind: "rule_risk",
        severity: "MATERIAL",
        challenge: `Requires ${rule.years} year(s) prior residence — the authority will verify this.`,
        rebuttal: "Documented proof of the residence period.",
        provenance: "rule:residence_years_min",
      });
    }
  }

  // ── Substance risk ───────────────────────────────────────────────────────
  if (programme.minimumStayDaysPerYear > 0) {
    grounds.push({
      id: "substance:presence",
      kind: "substance_risk",
      severity: "MATERIAL",
      challenge: `Continuing obligation: at least ${programme.minimumStayDaysPerYear} day(s) of physical presence per year.`,
      rebuttal: "The client's written acknowledgement of the presence requirement.",
      provenance: "catalogue:minimumStayDaysPerYear",
    });
  }

  // ── Compute readiness score ───────────────────────────────────────────────
  const totalPossible = programme.requirements.length + programme.watchFactors.length + programme.screening.length + (needsSof ? 1 : 0);
  const blockers = grounds.filter((g) => g.severity === "BLOCKER").length;
  const material = grounds.filter((g) => g.severity === "MATERIAL").length;
  const minor = grounds.filter((g) => g.severity === "MINOR").length;
  const penalty = blockers * 25 + material * 10 + minor * 3;
  const readinessScore = Math.max(0, Math.min(100, 100 - penalty));

  // ── Build toRequest list ─────────────────────────────────────────────────
  const toRequest = grounds
    .filter((g) => g.kind === "missing_document" || g.kind === "expired_document" || g.kind === "sof_gap")
    .map((g) => {
      const match = g.id.match(/^(?:missing|expired):(.+)$/);
      return match ? match[1] : null;
    })
    .filter((k): k is string => Boolean(k));

  const thesis = grounds.length === 0
    ? "No machine-checkable grounds found — the file is ready for human review."
    : `${grounds.length} ground(s) the authority could raise: ${blockers} blocker(s), ${material} material, ${minor} minor.`;

  return {
    programmeKey: programme.key,
    programmeLabel: programme.label,
    thesis,
    grounds,
    insufficientBasis: grounds.length === 0,
    toRequest,
    readinessScore,
  };
}
