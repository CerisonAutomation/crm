/**
 * Eligibility pre-scan engine — the desk's first-pass triage of a prospect.
 *
 * Evaluates the machine-checkable rules attached to each programme in
 * `src/lib/domain/programmes.ts` against an applicant's answers and returns a
 * factor-by-factor verdict.
 *
 * WHAT THIS IS NOT. It is not an eligibility determination, a legal opinion, or
 * a promise. Thresholds move by regulation, the authority's own checklist
 * governs, and an "ELIGIBLE" outcome means only "no rule we can check stands in
 * the way — a human should look at this". The `UNKNOWN` outcome exists precisely
 * so the engine never guesses: a missing answer is reported as missing.
 *
 * Prisma-free and side-effect-free, so it is unit-testable and importable from
 * the client portal without pulling the database in.
 */
import {
  programmeByKey,
  screenableProgrammes,
  type EligibilityRule,
  type Programme,
} from "@/lib/domain/programmes";

export type PreScanAnswers = {
  /** EU/EFTA vs third country — drives permit and quota routes. */
  nationalityZone?: "EU_EFTA" | "NON_EU";
  /** Liquid funds plus reachable capital, in CHF. */
  fundsChf?: number;
  ageYears?: number;
  /** Permit currently held in Switzerland, if any. */
  permit?: "NONE" | "L" | "B" | "C";
  /** Years of continuous residence in the destination country. */
  residenceYears?: number;
  /** Employment contract duration in months (0 = none). */
  employmentMonths?: number;
  /** Does the applicant intend to work in the destination country? */
  willWorkInSwitzerland?: boolean;
  /** Lives in a neighbouring state's border zone (permits the G route). */
  livesInBorderZone?: boolean;
};

export type PreScanFactor = {
  rule: EligibilityRule["rule"];
  label: string;
  result: "PASS" | "FAIL" | "UNKNOWN";
  detail: string;
};

export type PreScanOutcome = "ELIGIBLE" | "CONDITIONS" | "NOT_ELIGIBLE" | "NOT_SCREENABLE";

export type PreScanResult = {
  outcome: PreScanOutcome;
  factors: PreScanFactor[];
  serviceName: string;
  summary: string;
  /** Human language for the desk: what the applicant should prepare next. */
  nextSteps: string[];
};

const RULE_LABELS: Record<EligibilityRule["rule"], string> = {
  nationality_zone: "Nationality zone",
  funds_min: "Sufficient funds",
  age_min: "Minimum age",
  age_max: "Maximum age",
  permit_required: "Residence permit held",
  residence_years_min: "Years of residence",
  employment_months_min: "Employment contract duration",
  must_not_work: "No local employment",
  residence_abroad_border: "Residence abroad (border zone)",
};

const chf = (n: number) => `CHF ${n.toLocaleString("en-CH")}`;

function evaluate(rule: EligibilityRule, a: PreScanAnswers): PreScanFactor {
  const base = { rule: rule.rule, label: RULE_LABELS[rule.rule] } as const;
  const unknown = (detail: string): PreScanFactor => ({ ...base, result: "UNKNOWN", detail });

  switch (rule.rule) {
    case "nationality_zone": {
      if (!a.nationalityZone) return unknown("Nationality zone was not provided.");
      const pass = rule.zone === "ANY" || a.nationalityZone === rule.zone;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: pass
          ? `Applicant zone (${a.nationalityZone}) satisfies the requirement (${rule.zone}).`
          : `Route requires ${rule.zone} nationality; applicant is ${a.nationalityZone}.`,
      };
    }
    case "funds_min": {
      if (typeof a.fundsChf !== "number") return unknown("Available funds were not provided.");
      const pass = a.fundsChf >= rule.chf;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: pass
          ? `Provided ${chf(a.fundsChf)} meet the indicative minimum of ${chf(rule.chf)}.`
          : `Indicative minimum is ${chf(rule.chf)}; provided ${chf(a.fundsChf)}.`,
      };
    }
    case "age_min": {
      if (typeof a.ageYears !== "number") return unknown("Age was not provided.");
      const pass = a.ageYears >= rule.years;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: `Minimum age ${rule.years}; applicant is ${a.ageYears}.`,
      };
    }
    case "age_max": {
      if (typeof a.ageYears !== "number") return unknown("Age was not provided.");
      const pass = a.ageYears <= rule.years;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: `Maximum age ${rule.years}; applicant is ${a.ageYears}.`,
      };
    }
    case "permit_required": {
      if (!a.permit) return unknown("Current permit was not provided.");
      if (rule.permit === "NONE") return { ...base, result: "PASS", detail: "No permit requirement applies." };
      const held =
        a.permit === rule.permit ||
        (rule.permit === "B_OR_C" && (a.permit === "B" || a.permit === "C"));
      return {
        ...base,
        result: held ? "PASS" : "FAIL",
        detail: held
          ? `Held permit (${a.permit}) satisfies the requirement (${rule.permit}).`
          : `Route requires permit ${rule.permit}; applicant holds ${a.permit}.`,
      };
    }
    case "residence_years_min": {
      if (typeof a.residenceYears !== "number") return unknown("Years of residence were not provided.");
      const pass = a.residenceYears >= rule.years;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: `Requires ${rule.years} year(s) of residence; provided ${a.residenceYears}.`,
      };
    }
    case "employment_months_min": {
      if (typeof a.employmentMonths !== "number") return unknown("Employment duration was not provided.");
      const pass = a.employmentMonths >= rule.months;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: `Requires a contract of ${rule.months}+ months; provided ${a.employmentMonths}.`,
      };
    }
    case "must_not_work": {
      if (typeof a.willWorkInSwitzerland !== "boolean") return unknown("Employment intention was not provided.");
      const pass = rule.value ? !a.willWorkInSwitzerland : true;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: pass
          ? "No local employment planned — the requirement is met."
          : "This route requires the applicant NOT to take employment locally.",
      };
    }
    case "residence_abroad_border": {
      if (typeof a.livesInBorderZone !== "boolean") return unknown("Place of residence abroad was not provided.");
      const pass = rule.value ? a.livesInBorderZone : true;
      return {
        ...base,
        result: pass ? "PASS" : "FAIL",
        detail: pass
          ? "Residence abroad confirmed for the border-zone test."
          : "The applicant must reside in a neighbouring EU/EFTA border zone.",
      };
    }
  }
}

/**
 * Screen one programme. `answers` may be partial — every unanswered rule comes
 * back as UNKNOWN and forces a CONDITIONS verdict, never a false pass.
 */
export function runPreScan(programmeKey: string, answers: PreScanAnswers): PreScanResult {
  const entry: Programme | undefined = programmeByKey(programmeKey);
  if (!entry) {
    return {
      outcome: "NOT_SCREENABLE",
      factors: [],
      serviceName: programmeKey,
      summary: "Unknown programme key — nothing to screen.",
      nextSteps: ["Confirm the programme with the desk before screening."],
    };
  }
  if (entry.eligibility.length === 0) {
    return {
      outcome: "NOT_SCREENABLE",
      factors: [],
      serviceName: entry.label,
      summary: `${entry.label} is an advisory engagement with no machine-checkable rules.`,
      nextSteps: ["Book an assessment — the desk will scope the routes by hand."],
    };
  }

  const factors = entry.eligibility.map((r) => evaluate(r, answers));
  const fails = factors.filter((f) => f.result === "FAIL");
  const unknowns = factors.filter((f) => f.result === "UNKNOWN");

  const outcome: PreScanOutcome =
    fails.length > 0 ? "NOT_ELIGIBLE" : unknowns.length > 0 ? "CONDITIONS" : "ELIGIBLE";

  const summary =
    outcome === "ELIGIBLE"
      ? `All ${factors.length} screening rule${factors.length === 1 ? "" : "s"} passed for ${entry.label}.`
      : outcome === "NOT_ELIGIBLE"
        ? `${fails.length} requirement${fails.length === 1 ? "" : "s"} not met for ${entry.label}.`
        : `${unknowns.length} answer${unknowns.length === 1 ? "" : "s"} missing for ${entry.label} — the open points must be confirmed.`;

  const nextSteps: string[] = [];
  for (const f of fails) nextSteps.push(`Unmet: ${f.label}. ${f.detail}`);
  for (const f of unknowns) nextSteps.push(`Confirm: ${f.label}. ${f.detail}`);
  if (outcome === "NOT_ELIGIBLE") {
    nextSteps.push("Ask the desk to compare alternatives — a failed rule here often routes to a better-fit programme.");
  }
  if (outcome === "ELIGIBLE") {
    nextSteps.push("Prepare the document checklist and a source-of-funds schedule for the engagement file.");
  }
  for (const w of entry.watchFactors) nextSteps.push(`Weigh: ${w}`);

  return { outcome, factors, serviceName: entry.label, summary, nextSteps };
}

/**
 * Rank every programme the applicant could plausibly pursue. Used by the client
 * portal to answer "which route fits me?" — never to preselect a filing.
 */
export function rankProgrammes(answers: PreScanAnswers): Array<PreScanResult & { key: string }> {
  return screenableProgrammes()
    .map((p) => ({ key: p.key, ...runPreScan(p.key, answers) }))
    .sort(
      (a, b) =>
        OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome] ||
        b.factors.filter((f) => f.result === "PASS").length - a.factors.filter((f) => f.result === "PASS").length,
    );
}

const OUTCOME_RANK: Record<PreScanOutcome, number> = {
  ELIGIBLE: 0,
  CONDITIONS: 1,
  NOT_ELIGIBLE: 2,
  NOT_SCREENABLE: 3,
};

// ───────────────────────── adversarial counter-case ─────────────────────────
//
// The prescan above asks "does anything stand in the way?". This asks the
// opposite question — "what is the case AGAINST approving this file?" — and
// returns it as grounds the desk must rebut, one by one, instead of a checklist
// they tick. The point is to surface, in the file, the risk a busy RM would
// otherwise skim past.
//
// WHAT THIS IS NOT. It is not an independent adjudication. Every ground is a
// re-projection of rules, watch factors and catalogue fields the desk already
// has, so the memo can only argue what those encode. Persisted unread into a
// KYC/AML file it would be evidence theatre — the caller must treat it as a
// prompt for the human's reasoning, not a substitute for it.
//
// Prisma-free and side-effect-free, like the rest of this module.

export type CounterGroundKind =
  /** An eligibility rule that failed. */
  | "rule"
  /** An eligibility rule that cannot be decided without a missing answer. */
  | "unknown"
  /** A watch factor no rule can decide. */
  | "watchFactor"
  /** A programme screening check not yet recorded. */
  | "screening"
  /** A continuing obligation the applicant must accept. */
  | "obligation"
  /** Catalogue data whose currency should be re-confirmed. */
  | "currency";

export type CounterGroundSeverity = "BLOCKER" | "MATERIAL" | "MINOR";

export type CounterGround = {
  /** Stable id — safe to key a stored rebuttal on. */
  id: string;
  kind: CounterGroundKind;
  severity: CounterGroundSeverity;
  /** The case AGAINST approval, stated plainly. */
  statement: string;
  /** What would defeat it. */
  rebuttal: string;
  /** Where the ground comes from (rule / watch factor / catalogue field). */
  provenance: string;
  /** A programme requirement that answers it, when one applies. */
  documentKey?: string;
};

export type CounterCase = {
  programmeKey: string;
  serviceName: string;
  /** The one-line argument — why this file may not be approvable as it stands. */
  thesis: string;
  grounds: CounterGround[];
  /**
   * True when nothing could be argued. This is NOT an approval — only that no
   * machine-checkable ground exists, so the decision rests on the human alone.
   */
  insufficientBasis: boolean;
  /** Requirement keys the applicant should produce to answer the open grounds. */
  toRequest: string[];
};

export type CounterCaseOptions = {
  /** Screening keys already recorded for the case. Omit and screening grounds are skipped. */
  screeningDone?: readonly string[];
  /** Reference clock (defaults to now); injected so the memo is deterministic in tests. */
  now?: Date;
};

/** Days after which "figures last reviewed" is itself a ground. */
const REVIEW_STALE_DAYS = 120;
const MS_PER_DAY = 86_400_000;

/** Rule → the requirement that would answer it (only used when the programme lists it). */
const RULE_EVIDENCE: Partial<Record<EligibilityRule["rule"], string>> = {
  nationality_zone: "PASSPORT",
  funds_min: "SOURCE_OF_FUNDS_EVIDENCE",
  age_min: "BIRTH_CERTIFICATE",
  age_max: "BIRTH_CERTIFICATE",
  permit_required: "PROOF_OF_ADDRESS",
  residence_years_min: "PROOF_OF_ADDRESS",
  residence_abroad_border: "PROOF_OF_ADDRESS",
};

/** Only ever emit a requirement key the programme actually lists. */
function evidenceFor(programme: Programme, candidate?: string): string | undefined {
  if (!candidate) return undefined;
  return programme.requirements.includes(candidate) ? candidate : undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";

/**
 * Build the counter-case for one screened programme.
 *
 * Grounds are derived from the screening result and the programme catalogue:
 * failed rules (BLOCKER), unanswerable rules and un-addressed watch factors
 * (MATERIAL), unrecorded screening checks (MATERIAL, only when the caller says
 * which are done), continuing obligations (MATERIAL), and stale catalogue
 * figures (MINOR). Deterministic for a given input and clock.
 */
export function buildCounterCase(
  programme: Programme,
  result: PreScanResult,
  opts: CounterCaseOptions = {},
): CounterCase {
  const grounds: CounterGround[] = [];

  for (const f of result.factors) {
    const key = evidenceFor(programme, RULE_EVIDENCE[f.rule]);
    if (f.result === "FAIL") {
      grounds.push({
        id: `rule:${f.rule}`,
        kind: "rule",
        severity: "BLOCKER",
        statement: `${f.label} is not met — ${f.detail}`,
        rebuttal: `Evidence that satisfies "${f.label}", or a documented waiver.`,
        provenance: `rule:${f.rule}`,
        ...(key ? { documentKey: key } : undefined),
      });
    } else if (f.result === "UNKNOWN") {
      grounds.push({
        id: `unknown:${f.rule}`,
        kind: "unknown",
        severity: "MATERIAL",
        statement: `${f.label} cannot be assessed — an answer is missing, so the rule is neither cleared nor failed.`,
        rebuttal: `Supply the missing answer. ${f.detail}`,
        provenance: `rule:${f.rule}`,
        ...(key ? { documentKey: key } : undefined),
      });
    }
  }

  for (const w of programme.watchFactors) {
    grounds.push({
      id: `watch:${slug(w)}`,
      kind: "watchFactor",
      severity: "MATERIAL",
      statement: `Unaddressed weighed point: ${w}`,
      rebuttal: "A written assessment of this point for the file, signed off by the desk.",
      provenance: "watchFactor",
    });
  }

  // Screening grounds fire only when the caller tells us what is already done —
  // otherwise every programme would look untested, which is noise, not signal.
  if (opts.screeningDone) {
    const done = new Set(opts.screeningDone);
    for (const key of programme.screening) {
      if (!done.has(key)) {
        grounds.push({
          id: `screening:${key}`,
          kind: "screening",
          severity: "MATERIAL",
          statement: `Screening check "${key}" has not been recorded.`,
          rebuttal: `Run and record screening "${key}".`,
          provenance: `screening:${key}`,
        });
      }
    }
  }

  if (programme.minimumStayDaysPerYear > 0) {
    grounds.push({
      id: "obligation:presence",
      kind: "obligation",
      severity: "MATERIAL",
      statement: `Continuing obligation: at least ${programme.minimumStayDaysPerYear} day(s) of physical presence per year.`,
      rebuttal: "The client's written acknowledgement of the presence requirement.",
      provenance: "catalogue:minimumStayDaysPerYear",
    });
  }

  const reviewed = new Date(programme.reviewedOn);
  const now = opts.now ?? new Date();
  if (!Number.isNaN(reviewed.getTime())) {
    const ageDays = Math.floor((now.getTime() - reviewed.getTime()) / MS_PER_DAY);
    if (ageDays > REVIEW_STALE_DAYS) {
      grounds.push({
        id: "currency:reviewedOn",
        kind: "currency",
        severity: "MINOR",
        statement: `Programme figures were last reviewed ${ageDays} days ago (${programme.reviewedOn}); the thresholds may have moved.`,
        rebuttal: "Re-confirm the thresholds against the authority's current checklist before relying on them.",
        provenance: "catalogue:reviewedOn",
      });
    }
  }

  const insufficientBasis = grounds.length === 0;
  const blockers = grounds.filter((g) => g.severity === "BLOCKER").length;
  const material = grounds.filter((g) => g.severity === "MATERIAL").length;
  const thesis = insufficientBasis
    ? `No machine-checkable case can be made against ${programme.label} on the current answers — which is not an approval.`
    : `${blockers} blocking and ${material} material point(s) stand against ${programme.label}; each must be rebutted or explicitly accepted before the file advances.`;

  const toRequest = [...new Set(grounds.map((g) => g.documentKey).filter((k): k is string => Boolean(k)))];

  return { programmeKey: programme.key, serviceName: result.serviceName, thesis, grounds, insufficientBasis, toRequest };
}
