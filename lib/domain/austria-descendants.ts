/**
 * Austria — Citizenship for descendants of Holocaust victims.
 *
 * The legal basis is the restoration of citizenship under §58c/58d of the
 * Austrian Citizenship Act (StbG): a person whose ancestor was stripped of
 * Austrian citizenship (or was forced to flee) between 1933 and 1955 on
 * political, racial or religious grounds — and their descendants — may have
 * citizenship restored. It is not naturalisation and it is not an investment
 * route; the entire case turns on proving the ancestor's persecution.
 *
 * This module is the single source of truth for the PROCEDURE, not for the
 * legal test. It defines:
 *   • the eligibility questionnaire (the facts the desk must establish);
 *   • the indicative PRE-ASSESSMENT scoring rules (see below);
 *    * the documents a case assessment needs;
 *   • the fee schedule;
 *   • the ordered procedure steps — the "map" the client flow renders.
 *
 * PRE-ASSESSMENT — WHAT IT IS AND IS NOT
 * --------------------------------------
 * The scoring is an INDICATIVE routing signal. It never decides an application
 * and must never be presented as a likelihood of success by the authority; it
 * only answers "is this worth a relationship manager's time now". The rules
 * below are the operator's own heuristics, encoded so they are testable and
 * adjustable in one place.
 *
 * The rules as given overlap in places (a recognised persecution reason appears
 * both under High and under Medium). The interpretation encoded here is a
 * priority cascade, documented so it can be changed deliberately:
 *
 *   VERY HIGH — a document of proof is available AND a strong signal is present
 *               (Austrian citizenship, or a departure in 1933–1955 while the
 *               ancestor lived in Austria).
 *   MEDIUM    — no document AND the ancestor's citizenship is in the wider
 *               Austro-Hungarian successor region (not Austria itself) AND they
 *               lived in Austria in 1933–1955 AND left in that window AND were
 *               persecuted (a recognised reason, or "other").
 *   HIGH      — no document AND a strong signal (Austrian citizenship or a
 *               departure in 1933–1955 while the ancestor lived in Austria).
 *   VERY LOW  — everything else.
 *
 * Note on the overlap: a recognised persecution reason alone is NOT a strong
 * signal — it requires the regional context (inRegion + livedInAustria +
 * leftInWindow) to mean anything. The Medium band is reached by the
 * wider-region cases whose only signal is an "other" persecution reason, or by
 * regional cases with a recognised reason when the ancestor was not in Austria
 * in the window. This is a deliberate reading of the operator's rules, not a
 * legal determination.
 *
 * Prisma-free and side-effect-free: importable from a server route, a client
 * component and a unit test alike.
 */

// ───────────────────────────── persecution ─────────────────────────────

/** The reasons the NSDAP persecuted people, as the questionnaire offers them. */
export const PERSECUTION_REASONS = [
  { value: "jewish", label: "Jewish ancestry" },
  { value: "communist_party", label: "Member of the communist party" },
  { value: "politically_persecuted", label: "Politically persecuted (e.g. communist party member)" },
  { value: "mentally_impaired", label: "Mentally impaired" },
  { value: "gay", label: "Gay person" },
  { value: "other", label: "Other reason" },
] as const;

export type PersecutionReason = (typeof PERSECUTION_REASONS)[number]["value"];

export function persecutionReasonLabel(value: string): string {
  return PERSECUTION_REASONS.find((r) => r.value === value)?.label ?? value;
}

/**
 * The persecution reasons that are independently strong evidence of Nazi
 * persecution. "Other" is not: it needs the regional/circumstantial signals to
 * mean anything, which is exactly why it sits in the Medium band.
 */
export const RECOGNIZED_PERSECUTION: ReadonlySet<string> = new Set([
  "jewish",
  "communist_party",
  "politically_persecuted",
  "mentally_impaired",
  "gay",
]);

export function isRecognizedPersecution(reason: string | null | undefined): boolean {
  return Boolean(reason) && RECOGNIZED_PERSECUTION.has(reason as string);
}

// ───────────────────────────── citizenship sets ─────────────────────────────

export const AUSTRIAN_CITIZENSHIP = "Austria";

/**
 * The citizenships the operator counts as a direct Austrian / Austro-Hungarian
 * connection. Galicia and Bukovina were crown lands of the empire and are
 * commonly recorded as a "citizenship" on documents of the period.
 */
export const BROAD_CITIZENSHIPS: readonly string[] = [
  "Austria",
  "Galicia",
  "Bukovina",
  "Hungary",
  "Czech Republic",
  "Slovak Republic",
  "Croatia",
  "Slovenia",
  "Bosnia and Herzegovina",
];

/**
 * The Medium band: the broad set plus the further successor states the operator
 * named. Membership here is what distinguishes a Medium case from a Very low
 * one — the ancestor came from the region, was in Austria, and was persecuted.
 */
export const REGIONAL_CITIZENSHIPS: readonly string[] = [
  ...BROAD_CITIZENSHIPS,
  "Poland",
  "Ukraine",
  "Romania",
  "Serbia",
];

/** Citizenship options offered by the questionnaire, in display order. */
export const CITIZENSHIP_OPTIONS: readonly string[] = [
  ...REGIONAL_CITIZENSHIPS,
  "Germany",
  "Italy",
  "France",
  "United Kingdom",
  "Netherlands",
  "Belgium",
  "Switzerland",
  "Spain",
  "Portugal",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Ireland",
  "Greece",
  "Turkey",
  "United States",
  "Canada",
  "Australia",
  "New Zealand",
  "Argentina",
  "Brazil",
  "Chile",
  "South Africa",
  "Israel",
  "Russia",
  "Other",
];

// ───────────────────────────── scoring ─────────────────────────────

export type AssessmentLevel = "VERY_HIGH" | "HIGH" | "MEDIUM" | "VERY_LOW";

/** The facts the pre-assessment scores. Everything is optional except the ones
 *  the questionnaire marks required; the scoring degrades gracefully when a
 *  field is missing rather than inventing a verdict. */
export type AncestorAssessmentInput = {
  ancestorCitizenship?: string | null;
  livedInAustria1933to1955?: boolean | null;
  leftAustriaDate?: string | null;
  persecutionReason?: string | null;
  documentAvailable?: boolean | null;
};

export type AssessmentSignals = {
  isAustria: boolean;
  leftInWindow: boolean;
  recognizedPersecution: boolean;
  inRegion: boolean;
  documentAvailable: boolean;
};

export type CaseAssessment = {
  level: AssessmentLevel;
  /** Plain-language reasons this level was reached — shown to the client. */
  reasons: string[];
  /** Which signals fired, so the flow can show the breakdown. */
  signals: AssessmentSignals;
};

/** True when the departure date falls in the 1933–1955 window, inclusive. */
export function leftAustriaInWindow(date: string | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getUTCFullYear();
  return y >= 1933 && y <= 1955;
}

/**
 * The indicative pre-assessment. See the module header for the rules and the
 * interpretation of the overlaps. Never returns APPROVED/DECLINED — this is a
 * routing signal only.
 */
export function assessCase(input: AncestorAssessmentInput): CaseAssessment {
  const citizenship = (input.ancestorCitizenship ?? "").trim();
  const isAustria = citizenship === AUSTRIAN_CITIZENSHIP;
  const leftInWindow = leftAustriaInWindow(input.leftAustriaDate);
  const recognized = isRecognizedPersecution(input.persecutionReason);
  const inRegion = REGIONAL_CITIZENSHIPS.includes(citizenship);
  const livedInAustria = input.livedInAustria1933to1955 === true;
  const documentAvailable = input.documentAvailable === true;

  const signals: AssessmentSignals = { isAustria, leftInWindow, recognizedPersecution: recognized, inRegion, documentAvailable };
  const reasons: string[] = [];

  if (isAustria) reasons.push("The ancestor held Austrian citizenship.");
  if (leftInWindow) reasons.push("The ancestor left Austria between 1933 and 1955.");
  if (recognized) reasons.push("The ancestor was persecuted for a reason the desk treats as strong evidence.");
  if (inRegion && !isAustria) reasons.push("The ancestor's citizenship is from the wider Austro-Hungarian successor region.");

  const strongSignal = isAustria || (leftInWindow && livedInAustria);

  // VERY HIGH — a document of proof turns a strong signal into a near-certain file.
  if (documentAvailable && strongSignal) {
    reasons.unshift("A document of proof is available.");
    return { level: "VERY_HIGH", reasons, signals };
  }
  // MEDIUM — the regional cases: in Austria, departed in the window, persecuted.
  // Checked BEFORE High so a regional case with an "other" reason is not
  // swallowed by the High band (which also matches on leftInWindow alone).
  if (!documentAvailable && inRegion && livedInAustria && leftInWindow && !isAustria) {
    reasons.unshift(
      recognized
        ? "The ancestor's citizenship is from the successor region and the persecution reason is not one the desk can treat as strong on its own."
        : "The persecution reason is recorded as 'other' — the desk will need to establish the basis before advising.",
    );
    return { level: "MEDIUM", reasons, signals };
  }
  // HIGH — a strong signal with no document: worth a human's time, needs evidence.
  if (!documentAvailable && strongSignal) {
    reasons.unshift("No document of proof is available yet — the desk will assess the facts and advise what can be evidenced.");
    return { level: "HIGH", reasons, signals };
  }
  // VERY LOW — everything else.
  reasons.unshift("The answers do not yet establish a persecution-based claim. The desk will assess the full picture before advising.");
  return { level: "VERY_LOW", reasons, signals };
}

/** Short client-facing label for a level. */
export function assessmentLevelLabel(level: AssessmentLevel): string {
  switch (level) {
    case "VERY_HIGH": return "Very high";
    case "HIGH": return "High";
    case "MEDIUM": return "Medium";
    case "VERY_LOW": return "Very low";
  }
}

/** One-line client-facing summary for a level. */
export function assessmentLevelSummary(level: AssessmentLevel): string {
  switch (level) {
    case "VERY_HIGH": return "The facts you have described, supported by a document, are a strong basis for a restoration claim.";
    case "HIGH": return "The facts you have described are a promising basis; the desk will now establish what can be evidenced.";
    case "MEDIUM": return "There is a possible claim. The desk will assess the regional and persecution evidence before advising.";
    case "VERY_LOW": return "On the answers given, a claim is not yet established. The desk will review the full picture with you.";
  }
}

// ───────────────────────────── questionnaire ─────────────────────────────

export type QuestionnaireFieldKind = "TEXT" | "DATE" | "YES_NO" | "SELECT" | "CHECKBOX" | "TEXTAREA";

export type QuestionnaireField = {
  key: string;
  label: string;
  kind: QuestionnaireFieldKind;
  required: boolean;
  help?: string;
  options?: readonly string[];
  /** Only show this field when the answer to `showWhen` equals `showWhenValue`. */
  showWhen?: { field: string; value: string };
  /** The per-question "document of proof available" tickbox. */
  proof?: boolean;
};

/**
 * The eligibility questionnaire, in the order a person should answer it.
 * Every field carries a `proof` slot so the client can say, per question,
 * whether they hold a document of proof — which is what the pre-assessment
 * scores.
 */
export function questionnaireFields(): QuestionnaireField[] {
  return [
    { key: "ancestorName", label: "Name of your ancestor", kind: "TEXT", required: true, proof: true },
    { key: "ancestorBirthDate", label: "Birthdate of your ancestor", kind: "DATE", required: true, proof: true },
    { key: "ancestorBirthPlace", label: "Place of birth of your ancestor", kind: "TEXT", required: true, proof: true },
    {
      key: "ancestorCitizenship", label: "Citizenship of your ancestor", kind: "SELECT", required: true,
      options: CITIZENSHIP_OPTIONS, proof: true,
      help: "As recorded on the ancestor's documents of the period.",
    },
    {
      key: "livedInAustria1933to1955", label: "Did your ancestor live in Austria between 1933 and 1955?", kind: "YES_NO", required: true, proof: true,
    },
    {
      key: "livedInAustriaBefore1933", label: "Did your ancestor live in Austria before 1933?", kind: "YES_NO", required: false, proof: true,
      showWhen: { field: "livedInAustria1933to1955", value: "NO" },
    },
    {
      key: "location1933to1955", label: "Where did your ancestor live between 1933 and 1955? (city, country)", kind: "TEXT", required: false, proof: true,
      showWhen: { field: "livedInAustria1933to1955", value: "NO" },
      help: "Only if they were not in Austria during those years.",
    },
    {
      key: "leftAustriaDate", label: "When did your persecuted ancestor leave Austria? (day, month, year)", kind: "DATE", required: true, proof: true,
      help: "The date of flight or expulsion, as best you know it.",
    },
    {
      key: "persecutionReason", label: "Reason for persecution by the NSDAP", kind: "SELECT", required: true,
      options: PERSECUTION_REASONS.map((r) => r.value), proof: true,
    },
    {
      key: "deportedToCamp", label: "Was deported to a concentration camp", kind: "CHECKBOX", required: false, proof: true,
    },
    {
      key: "killedInCamp", label: "Was killed in a concentration camp", kind: "CHECKBOX", required: false, proof: true,
    },
    {
      key: "background", label: "Please give us some further background information about your persecuted ancestor and your family.",
      kind: "TEXTAREA", required: false, proof: true,
      help: "Names, dates, places, what the family has passed down. Two or three sentences is enough to start.",
    },
  ];
}

export type QuestionnaireAnswers = Record<string, string | boolean>;

/** Required fields still unanswered — the "can I continue?" gate. */
export function missingQuestionnaireFields(answers: QuestionnaireAnswers): string[] {
  return questionnaireFields()
    .filter((f) => f.required && visibleField(f, answers))
    .filter((f) => String(answers[f.key] ?? "").trim() === "" && answers[f.key] !== true)
    .map((f) => f.label);
}

/** Whether a conditional field should be shown, given the answers so far. */
export function visibleField(field: QuestionnaireField, answers: QuestionnaireAnswers): boolean {
  if (!field.showWhen) return true;
  return String(answers[field.showWhen.field] ?? "") === field.showWhen.value;
}

/** The persecution reason as a stored select value, or null. */
export function persecutionReasonFromAnswers(answers: QuestionnaireAnswers): string | null {
  const v = answers.persecutionReason;
  return typeof v === "string" && v ? v : null;
}

// ───────────────────────────── case documents ─────────────────────────────

export type CaseDocumentSpec = {
  key: string;
  label: string;
  /** What the desk uses it for, in client language. */
  purpose: string;
};

/**
 * The documents a case assessment needs. "Other" is always available because a
 * client often cannot tell what a German-language document is; the relationship
 * manager re-types it afterwards.
 */
export const CASE_ASSESSMENT_DOCUMENTS: readonly CaseDocumentSpec[] = [
  { key: "ANCESTOR_PASSPORT", label: "Passport of ancestor", purpose: "Identity and citizenship of the ancestor." },
  { key: "ANCESTOR_BIRTH_CERTIFICATE", label: "Birth certificate of ancestor", purpose: "Birth date and place, and parentage." },
  { key: "ANCESTOR_MARRIAGE_CERTIFICATE", label: "Marriage certificate of ancestor", purpose: "Name changes and the family line." },
  { key: "CITIZENSHIP_CERTIFICATE", label: "Citizenship certificate", purpose: "The ancestor's Austrian citizenship." },
  { key: "SHIP_MANIFEST", label: "Ship manifesto", purpose: "The route and date of departure or expulsion." },
  { key: "NATURALIZATION_DOCUMENTS", label: "Naturalization documents", purpose: "Citizenship acquired elsewhere after flight." },
  { key: "OTHER", label: "Other document", purpose: "Anything else — the relationship manager will re-type it." },
];

// ───────────────────────────── fees ─────────────────────────────

export type FeeSchedule = {
  currency: "EUR";
  /** Case assessment, standard. */
  assessment: number;
  /** Case assessment including archive research (up to 3 hours). */
  assessmentWithResearch: number;
  /** Service fee, main applicant. */
  serviceFee: number;
  /** Per dependant. */
  dependantFee: number;
  /** Due-diligence fee, adult dependants only. */
  adultDueDiligenceFee: number;
  /** Surcharge when paying by credit card. */
  creditCardSurchargePct: number;
};

export const FEE_SCHEDULE: FeeSchedule = {
  currency: "EUR",
  assessment: 500,
  assessmentWithResearch: 600,
  serviceFee: 3000,
  dependantFee: 450,
  adultDueDiligenceFee: 90,
  creditCardSurchargePct: 3,
};

/** The assessment fee, given whether archive research is included. */
export function assessmentFee(withResearch: boolean): number {
  return withResearch ? FEE_SCHEDULE.assessmentWithResearch : FEE_SCHEDULE.assessment;
}

/** The credit-card surcharge for a given subtotal, in whole currency units. */
export function creditCardSurcharge(subtotal: number): number {
  return Math.round((subtotal * FEE_SCHEDULE.creditCardSurchargePct) / 100);
}

// ───────────────────────────── procedure steps (the map) ─────────────────────────────

export type ProcedureStep = {
  key: string;
  label: string;
  /** Client-facing description of what happens at this step. */
  detail: string;
  /** Who performs it. */
  actor: "CLIENT" | "DESK" | "BOTH";
  /** Whether this step is interactive in the client flow today. */
  interactive: boolean;
};

/**
 * The whole procedure, in order — the map the client flow renders. The first
 * five steps are interactive in this flow; the rest are defined here so the
 * client sees the full journey and the desk has one ordered list to run.
 */
export const PROCEDURE_STEPS: readonly ProcedureStep[] = [
  {
    key: "questionnaire", label: "Eligibility questionnaire", actor: "CLIENT", interactive: true,
    detail: "Tell us about your ancestor and their persecution, and whether you hold a document of proof.",
  },
  {
    key: "pre_assessment", label: "Pre-assessment", actor: "DESK", interactive: true,
    detail: "We score the answers against the desk's rules and show you where the case stands.",
  },
  {
    key: "profile", label: "Create your profile", actor: "CLIENT", interactive: true,
    detail: "Your personal details, and your passport if you have it to hand (not mandatory yet).",
  },
  {
    key: "documents", label: "Upload case documents", actor: "CLIENT", interactive: true,
    detail: "The documents the desk needs for a case assessment — and, if you have none, optional archive research.",
  },
  {
    key: "agreement_pay", label: "Client agreement & payment", actor: "CLIENT", interactive: true,
    detail: "Sign the client agreement online and pay the assessment fee.",
  },
  {
    key: "consultation", label: "Consultation with your advisor", actor: "BOTH", interactive: false,
    detail: "Book a consultation with your relationship manager. Earliest slot is three business days after upload, to allow assessment.",
  },
  {
    key: "case_assessment", label: "Case & document assessment", actor: "DESK", interactive: false,
    detail: "Your advisor reviews and comments on each document and confirms eligibility.",
  },
  {
    key: "dependants", label: "Add dependants", actor: "CLIENT", interactive: false,
    detail: "Name any family members included in the application. Addresses already entered are reused.",
  },
  {
    key: "invoice", label: "Invoice & payment", actor: "BOTH", interactive: false,
    detail: "We issue the invoice (to your accounting system). Pay by wire or credit card; a 3% card fee applies.",
  },
  {
    key: "personal_documents", label: "Personal documents", actor: "CLIENT", interactive: false,
    detail: "Certified passport, certified criminal record and other personal documents — we track validity for you.",
  },
  {
    key: "cover_letter", label: "Cover letter", actor: "BOTH", interactive: false,
    detail: "We draft the application cover letter from everything you have provided; your advisor reviews and approves it.",
  },
  {
    key: "submission", label: "Application & submission", actor: "DESK", interactive: false,
    detail: "The application PDF is generated and submitted, with original documents where the authority requires them.",
  },
];

export function procedureStepByKey(key: string): ProcedureStep | undefined {
  return PROCEDURE_STEPS.find((s) => s.key === key);
}
