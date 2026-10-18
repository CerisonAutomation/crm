/**
 * Canonical advisory lifecycle, catalogs, and action types.
 *
 * ONE declarative source of truth for *what happens, in what order, who may do
 * it, what it needs, and what it emits*. Nothing here is baked into a component
 * or a route: the RM desk, the client portal, document requests, and the
 * automation topics all read these tables. Adding a service, a document type, a
 * screening check, or a lifecycle gate is therefore a DATA edit in this one
 * file — no scattered conditionals, no hardcoded lists in JSX.
 *
 * The lifecycle mirrors the operating model of the RM desk:
 *
 *   profile → uploads → OCR → client confirms → [data approval ×2]
 *   → screening → service choice → [service approval] → welcome
 *   → document requests → per-document review → dispatch (DHL) → follow-up
 *   → approval in principle → letter upload → completion
 *
 * Prisma-free and side-effect-free, so it is unit-testable and importable from
 * both server and client modules.
 */

// ───────────────────────────── action types ─────────────────────────────

/**
 * Every consequential action a human can take. Used for audit records, the
 * timeline UI, and permission checks, so a new action is one entry here plus a
 * capability in `states.ts`.
 */
export const ACTION_TYPES = [
  // lifecycle
  "profile.create",
  "data.submit",
  "data.correct",
  "data.approve.primary",
  "data.approve.secondary",
  "service.select",
  "service.approve",
  "service.comment",
  "welcome.send",
  // documents
  "document.upload",
  "document.ocr",
  "document.confirm",
  "document.approve",
  "document.reject",
  "document.request",
  "document.request.additional",
  "document.comment",
  "letter.upload",
  // screening
  "screening.run",
  "screening.clear",
  "screening.flag",
  // compliance intake
  "sof.submit",
  "sof.review",
  "prescan.run",
  // dispatch + authority
  "dispatch.prepare",
  "dispatch.send",
  "followup.schedule",
  "followup.log",
  "approval.in_principle.record",
  "case.complete",
  "case.cancel",
  // comms + crm
  "message.send",
  "comment.create",
  "reminder.create",
  "booking.create",
  "notification.read",
  // automation + platform
  "workflow.publish",
  "workflow.mirror",
  "page.publish",
  "automation.pause",
  "automation.resume",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Grouping for the timeline / audit filters. */
export const ACTION_GROUPS: Record<string, readonly ActionType[]> = {
  Lifecycle: ["profile.create", "data.submit", "data.correct", "data.approve.primary", "data.approve.secondary", "service.select", "service.approve", "service.comment", "welcome.send"],
  Documents: ["document.upload", "document.ocr", "document.confirm", "document.approve", "document.reject", "document.request", "document.request.additional", "document.comment", "letter.upload"],
  Screening: ["screening.run", "screening.clear", "screening.flag", "sof.submit", "sof.review", "prescan.run"],
  Authority: ["dispatch.prepare", "dispatch.send", "followup.schedule", "followup.log", "approval.in_principle.record", "case.complete", "case.cancel"],
  Engagement: ["message.send", "comment.create", "reminder.create", "booking.create", "notification.read"],
  Platform: ["workflow.publish", "workflow.mirror", "page.publish", "automation.pause", "automation.resume"],
};

// ───────────────────────────── screening (KYC/AML) ─────────────────────────────

export type ScreeningCheck = {
  key: string;
  label: string;
  /** What the check establishes, in operator language. */
  purpose: string;
  /** A failure is a hard stop unless the case is escalated for sign-off. */
  severity: "BLOCKER" | "REVIEW";
  /** Checks that run on every case; others are service/jurisdiction specific. */
  required: boolean;
};

/**
 * Screening catalogue. `required: true` checks always run; the rest are pulled
 * in by the selected service (see `SERVICE_CATALOG[].screening`).
 */
export const SCREENING_CHECKS: readonly ScreeningCheck[] = [
  { key: "IDENTITY", label: "Identity verification", purpose: "Confirm the applicant is who the passport says they are.", severity: "BLOCKER", required: true },
  { key: "SANCTIONS", label: "Sanctions screening", purpose: "Screen against consolidated sanctions lists.", severity: "BLOCKER", required: true },
  { key: "PEP", label: "Politically exposed person", purpose: "Establish PEP status and source of wealth implications.", severity: "REVIEW", required: true },
  { key: "ADVERSE_MEDIA", label: "Adverse media", purpose: "Surface negative press relevant to the applicant.", severity: "REVIEW", required: true },
  { key: "AML_SOF", label: "Source of funds", purpose: "Evidence the investment funds are legitimate.", severity: "BLOCKER", required: true },
  { key: "AML_SOW", label: "Source of wealth", purpose: "Evidence how the applicant's wealth was accumulated.", severity: "BLOCKER", required: false },
  { key: "TAX_COMPLIANCE", label: "Tax compliance", purpose: "Confirm tax residency declarations and CRS/FATCA position.", severity: "REVIEW", required: false },
  { key: "CRIMINAL_RECORD", label: "Criminal record", purpose: "Review the police record for disqualifying offences.", severity: "BLOCKER", required: true },
  { key: "BANK_VERIFY", label: "Bank reference", purpose: "Confirm the banking relationship and account standing.", severity: "REVIEW", required: false },
];

/** Checks that must run for every case, regardless of service. */
export const REQUIRED_SCREENING: readonly string[] = SCREENING_CHECKS.filter((c) => c.required).map((c) => c.key);

/** True when any check in the set is a blocker that failed. */
export function screeningBlocks(checks: ReadonlyArray<{ key: string; result: string }>): boolean {
  const byKey = new Map(checks.map((c) => [c.key, c.result]));
  return SCREENING_CHECKS.some((c) => c.severity === "BLOCKER" && byKey.get(c.key) === "FAIL");
}

/** The unresolved blockers still outstanding for a case. */
export function outstandingScreenings(done: ReadonlyArray<{ key: string; result: string }>): ScreeningCheck[] {
  const byKey = new Map(done.map((c) => [c.key, c.result]));
  return SCREENING_CHECKS.filter((c) => (c.required || true) && byKey.get(c.key) !== "PASS");
}

// ───────────────────────────── services (the dropdown) ─────────────────────────────

export type ServiceOffering = {
  key: string;
  label: string;
  /** Destination jurisdiction / programme. */
  jurisdiction:
    | "GERMANY" | "AUSTRIA" | "MALTA" | "PORTUGAL" | "SWITZERLAND"
    | "ANTIGUA" | "ARMENIA" | "CYPRUS" | "GREECE" | "ITALY"
    | "MONTENEGRO" | "ST_KITTS" | "SLOVAKIA" | "SLOVENIA" | "SPAIN"
    | "TURKIYE" | "UAE" | "USA" | "VANUATU"
    | "OTHER";
  kind: "RESIDENCE" | "CITIZENSHIP" | "CORPORATE" | "INVESTMENT" | "ADVISORY";
  summary: string;
  /** Indicative threshold in `currency`; 0 when not investment-based. */
  minInvestment: number;
  currency: string;
  /** Extra screening pulled in by this service. */
  screening: readonly string[];
  /** Typical authority processing time, used to seed the follow-up cadence. */
  processingWeeks: number;
};

/**
 * The service dropdown. Rendering is driven by this list, so a new programme is
 * one entry — never a JSX branch.
 */
export const SERVICE_CATALOG: readonly ServiceOffering[] = [
  { key: "DE_RESIDENCE_BUSINESS", label: "Germany — Residence by Business Investment", jurisdiction: "GERMANY", kind: "RESIDENCE", summary: "Residence permit via business investment and a viable operating entity.", minInvestment: 250_000, currency: "EUR", screening: ["AML_SOW"], processingWeeks: 16 },
  { key: "DE_BLUE_CARD", label: "Germany — EU Blue Card", jurisdiction: "GERMANY", kind: "RESIDENCE", summary: "Highly-qualified professional route with an employment contract.", minInvestment: 0, currency: "EUR", screening: [], processingWeeks: 10 },
  { key: "AT_RESIDENCE", label: "Austria — Residence Permit", jurisdiction: "AUSTRIA", kind: "RESIDENCE", summary: "Red-white-red card and settlement routes for investors and professionals.", minInvestment: 100_000, currency: "EUR", screening: ["AML_SOW"], processingWeeks: 14 },
  { key: "MT_CITIZENSHIP_MEIN", label: "Malta — Citizenship by Naturalisation (MEIN)", jurisdiction: "MALTA", kind: "CITIZENSHIP", summary: "Citizenship by exceptional investment and a residency period.", minInvestment: 600_000, currency: "EUR", screening: ["AML_SOW", "TAX_COMPLIANCE", "BANK_VERIFY"], processingWeeks: 36 },
  { key: "PT_GOLDEN", label: "Portugal — Residence by Investment", jurisdiction: "PORTUGAL", kind: "RESIDENCE", summary: "Residence through qualifying investment funds.", minInvestment: 500_000, currency: "EUR", screening: ["AML_SOW", "BANK_VERIFY"], processingWeeks: 24 },
  { key: "CH_LUMP_SUM", label: "Switzerland — Lump-sum Taxation", jurisdiction: "SWITZERLAND", kind: "RESIDENCE", summary: "Residence permit tied to a negotiated tax arrangement with a canton.", minInvestment: 0, currency: "CHF", screening: ["AML_SOW", "TAX_COMPLIANCE", "BANK_VERIFY"], processingWeeks: 20 },
  { key: "ADVISORY_ONLY", label: "Advisory / Assessment only", jurisdiction: "OTHER", kind: "ADVISORY", summary: "Eligibility assessment and structure advice without a filing.", minInvestment: 0, currency: "EUR", screening: [], processingWeeks: 2 },

  // ── Ancillary services (harvested from citizen-lane.com "Our services") ──
  // These carry no investment threshold but run the same identity/AML screens,
  // because each one touches a bank, a registry or an immigration authority.
  { key: "SVC_PASSPORT_RENEWAL_KN", label: "Passport Renewal — St. Kitts & Nevis", jurisdiction: "ST_KITTS", kind: "CORPORATE", summary: "Renewal of a St. Kitts & Nevis passport, including dependent and consular follow-through.", minInvestment: 0, currency: "USD", screening: ["IDENTITY", "AML_SOF"], processingWeeks: 6 },
  { key: "SVC_COMPANY_MALTA", label: "Company Set Up — Malta", jurisdiction: "MALTA", kind: "CORPORATE", summary: "Maltese company formation and structuring, with the bank account and tax registration that follow it.", minInvestment: 0, currency: "EUR", screening: ["AML_SOW", "BANK_VERIFY"], processingWeeks: 6 },
  { key: "SVC_COMPANY_UAE_MEYDAN", label: "Company Set Up — UAE (Meydan Free Zone)", jurisdiction: "UAE", kind: "CORPORATE", summary: "Establishment in the Meydan Free Zone — licence, residency visa sponsor and corporate account.", minInvestment: 0, currency: "AED", screening: ["AML_SOW", "BANK_VERIFY"], processingWeeks: 4 },
  { key: "SVC_BANK_ACCOUNT", label: "Bank Account Opening", jurisdiction: "OTHER", kind: "CORPORATE", summary: "Introduction and file preparation for a personal or corporate account with a private bank.", minInvestment: 0, currency: "EUR", screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY", "TAX_COMPLIANCE"], processingWeeks: 8 },
  { key: "SVC_JOB_SEARCH", label: "Job Search Support", jurisdiction: "OTHER", kind: "ADVISORY", summary: "Employer introductions and permit-linked job placement support.", minInvestment: 0, currency: "EUR", screening: ["IDENTITY"], processingWeeks: 12 },

  // ── Investment lines (harvested from citizen-lane.com "Investments") ──
  { key: "INV_REAL_ESTATE", label: "Real Estate Portfolio", jurisdiction: "OTHER", kind: "INVESTMENT", summary: "Curated qualifying property across European and Caribbean markets, matched to a programme's threshold.", minInvestment: 200_000, currency: "EUR", screening: ["AML_SOF", "AML_SOW"], processingWeeks: 10 },
  { key: "INV_FUNDS_BUSINESS", label: "Investment Funds & Businesses", jurisdiction: "OTHER", kind: "INVESTMENT", summary: "Approved fund subscriptions and direct business investments that qualify under Golden Visa regimes.", minInvestment: 250_000, currency: "EUR", screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY"], processingWeeks: 12 },
  { key: "INV_PORTUGAL_GOLDEN", label: "Portugal Golden Visa Investments", jurisdiction: "PORTUGAL", kind: "INVESTMENT", summary: "Qualifying Portuguese fund and business opportunities structured for the Golden Visa.", minInvestment: 500_000, currency: "EUR", screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY"], processingWeeks: 20 },
  { key: "INV_ITALY_VENICE_HOTEL", label: "Hotel Investment — Italian Golden Visa (Venice)", jurisdiction: "ITALY", kind: "INVESTMENT", summary: "Venice hospitality development qualifying under the Italian investor residence programme.", minInvestment: 250_000, currency: "EUR", screening: ["AML_SOF", "AML_SOW"], processingWeeks: 24 },
  { key: "INV_ERLEBNISBAHN", label: "Erlebnisbahn", jurisdiction: "OTHER", kind: "INVESTMENT", summary: "Sustainable leisure-infrastructure investment alongside the firm's green-energy projects.", minInvestment: 100_000, currency: "EUR", screening: ["AML_SOF", "AML_SOW"], processingWeeks: 16 },
];

export const SERVICE_KEYS: readonly string[] = SERVICE_CATALOG.map((s) => s.key);
export function serviceByKey(key: string): ServiceOffering | undefined {
  return SERVICE_CATALOG.find((s) => s.key === key);
}

// ───────────────────────────── document catalog ─────────────────────────────

export type DocumentSpec = {
  key: string;
  label: string;
  category: "IDENTITY" | "LEGAL" | "FINANCIAL" | "CORPORATE" | "MEDICAL" | "OTHER";
  /** Who issues it — drives the client-facing instruction text. */
  issuedBy: string;
  /** Run OCR/extraction on upload (identity + financial docs are worth it). */
  extract: boolean;
  /** Must carry a wet/e-signature or certified copy. */
  certified: boolean;
  /** Validity window in months; null = no expiry. */
  validityMonths: number | null;
};

/**
 * Document catalogue — the "document request" picker. Superset of the coarse
 * `DOC_TYPES` in `states.ts` (kept for backwards compatibility with stored rows).
 */
export const DOCUMENT_CATALOG: readonly DocumentSpec[] = [
  { key: "PASSPORT", label: "Passport", category: "IDENTITY", issuedBy: "Applicant's national authority", extract: true, certified: false, validityMonths: null },
  { key: "NATIONAL_ID", label: "National ID card", category: "IDENTITY", issuedBy: "Applicant's national authority", extract: true, certified: false, validityMonths: 120 },
  { key: "DRIVING_LICENCE", label: "Driving licence", category: "IDENTITY", issuedBy: "Applicant's licensing authority", extract: true, certified: false, validityMonths: 120 },
  { key: "BIRTH_CERTIFICATE", label: "Birth certificate", category: "LEGAL", issuedBy: "Civil registry", extract: true, certified: true, validityMonths: null },
  { key: "MARRIAGE_CERTIFICATE", label: "Marriage certificate", category: "LEGAL", issuedBy: "Civil registry", extract: false, certified: true, validityMonths: null },
  { key: "POLICE_RECORD", label: "Police record / criminal clearance", category: "LEGAL", issuedBy: "Police or justice authority", extract: false, certified: true, validityMonths: 6 },
  { key: "PROOF_OF_ADDRESS", label: "Proof of address", category: "LEGAL", issuedBy: "Utility, bank, or municipal authority", extract: false, certified: false, validityMonths: 3 },
  { key: "CERTIFICATE_OF_REGISTRATION", label: "Certificate of registration", category: "CORPORATE", issuedBy: "Companies registry", extract: true, certified: true, validityMonths: 6 },
  { key: "ARTICLES_OF_ASSOCIATION", label: "Articles of association", category: "CORPORATE", issuedBy: "Companies registry", extract: false, certified: true, validityMonths: null },
  { key: "SHAREHOLDER_REGISTER", label: "Register of shareholders", category: "CORPORATE", issuedBy: "Company secretary", extract: false, certified: true, validityMonths: 3 },
  { key: "BANK_STATEMENT", label: "Bank statements", category: "FINANCIAL", issuedBy: "Applicant's bank", extract: true, certified: false, validityMonths: 3 },
  { key: "BANK_REFERENCE_LETTER", label: "Bank reference letter", category: "FINANCIAL", issuedBy: "Applicant's bank", extract: false, certified: false, validityMonths: 3 },
  { key: "SOURCE_OF_FUNDS_EVIDENCE", label: "Source of funds evidence", category: "FINANCIAL", issuedBy: "Applicant / bank / auditor", extract: false, certified: false, validityMonths: null },
  { key: "AUDITED_ACCOUNTS", label: "Audited financial statements", category: "FINANCIAL", issuedBy: "Auditor", extract: false, certified: true, validityMonths: 12 },
  { key: "TAX_RECORD", label: "Tax residence certificate", category: "FINANCIAL", issuedBy: "Tax authority", extract: false, certified: false, validityMonths: 12 },
  { key: "MEDICAL_CERTIFICATE", label: "Medical certificate", category: "MEDICAL", issuedBy: "Licensed physician", extract: false, certified: false, validityMonths: 3 },
  { key: "HEALTH_INSURANCE", label: "Health insurance policy", category: "MEDICAL", issuedBy: "Insurer", extract: false, certified: false, validityMonths: 12 },
  { key: "CURRICULUM_VITAE", label: "Curriculum vitae", category: "OTHER", issuedBy: "Applicant", extract: false, certified: false, validityMonths: null },
  { key: "POWER_OF_ATTORNEY", label: "Power of attorney", category: "LEGAL", issuedBy: "Notary", extract: false, certified: true, validityMonths: null },
  { key: "APPROVAL_LETTER", label: "Approval letter (authority)", category: "LEGAL", issuedBy: "Receiving authority", extract: true, certified: false, validityMonths: null },
  { key: "OTHER", label: "Other document", category: "OTHER", issuedBy: "As instructed", extract: false, certified: false, validityMonths: null },
];

export const DOCUMENT_KEYS: readonly string[] = DOCUMENT_CATALOG.map((d) => d.key);
export function documentSpec(key: string): DocumentSpec | undefined {
  return DOCUMENT_CATALOG.find((d) => d.key === key);
}
export function documentsForCategory(category: DocumentSpec["category"]): DocumentSpec[] {
  return DOCUMENT_CATALOG.filter((d) => d.category === category);
}

/**
 * Map an uploaded/requested document `type` onto a canonical DOCUMENT_CATALOG
 * key. The coarse `DOC_TYPES` in states.ts and the catalogue share their five
 * overlapping values by literal key; the extra catalogue keys pass through. A
 * small alias table catches the legacy spellings so a stored row still
 * reconciles against a programme's requirements.
 */
const DOCUMENT_KEY_ALIASES: Record<string, string> = {
  ID_CARD: "NATIONAL_ID",
  IDENTITY_CARD: "NATIONAL_ID",
  PASSPORT_COPY: "PASSPORT",
  POLICE_CLEARANCE: "POLICE_RECORD",
  CRIMINAL_RECORD: "POLICE_RECORD",
  COMPANY_REGISTRATION: "CERTIFICATE_OF_REGISTRATION",
  BANK_STATEMENTS: "BANK_STATEMENT",
  PROOF_OF_FUNDS: "SOURCE_OF_FUNDS_EVIDENCE",
};

export function canonicalDocumentKey(type: string): string {
  const t = type.trim().toUpperCase();
  return DOCUMENT_KEY_ALIASES[t] ?? t;
}

// ───────────────────────────── lifecycle stages ─────────────────────────────

/** Where a stage sits in the process, which decides how the UI treats it. */
export type StageKind =
  /** A human does something (upload, approve, comment). */
  | "ACTION"
  /** A decision gate that can send the case backwards. */
  | "GATE"
  /** The platform does it (OCR, notifications, dispatch prep). */
  | "AUTOMATION"
  /** Purely informational to the client. */
  | "NOTICE";

export type LifecycleStage = {
  key: string;
  label: string;
  /** The `CaseState` this stage corresponds to (see states.ts). */
  caseState: string;
  kind: StageKind;
  /** Roles allowed to perform it; empty = the platform performs it. */
  actors: readonly string[];
  /** Capability required (deny-by-default); null for platform/informational. */
  capability: string | null;
  /**
   * Requires a SECOND, different approver — the "secondary approval" the desk
   * operates with (RM proposes, SENIOR_RM signs off).
   */
  secondaryApproval: boolean;
  /** Automation topics emitted when the stage completes. */
  emits: readonly string[];
  /** Client-facing explanation, used by the portal timeline. */
  clientCopy: string;
  /** Whether the client sees this stage on their timeline. */
  clientVisible: boolean;
  /** Expected working days before this stage should be chased. */
  slaDays: number;
};

/**
 * The advisory lifecycle, in order. `states.ts` governs which transitions are
 * LEGAL; this table governs what each transition MEANS, who performs it, and
 * what it emits. The two are kept separate deliberately: legality is a safety
 * property, meaning is an operating-model concern.
 */
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  {
    key: "PROFILE_CREATED", label: "Create client profile", caseState: "ONBOARDING", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "case.assign", secondaryApproval: false,
    emits: ["case.created"], clientCopy: "Your advisor has opened your file.", clientVisible: true, slaDays: 1,
  },
  {
    key: "IDENTITY_UPLOADED", label: "Upload identity documents", caseState: "ONBOARDING", kind: "ACTION",
    actors: ["CLIENT", "RM", "SENIOR_RM"], capability: "document.upload.own", secondaryApproval: false,
    emits: ["document.uploaded"], clientCopy: "Upload your passport or national ID so we can extract your details.", clientVisible: true, slaDays: 3,
  },
  {
    key: "OCR_EXTRACTED", label: "Extract data from documents", caseState: "ONBOARDING", kind: "AUTOMATION",
    actors: [], capability: null, secondaryApproval: false,
    emits: ["ocr.completed", "ocr.needs_review"], clientCopy: "We are reading the details from your documents.", clientVisible: true, slaDays: 1,
  },
  {
    key: "CLIENT_CONFIRMS_DATA", label: "Confirm your details", caseState: "DATA_SUBMITTED", kind: "ACTION",
    actors: ["CLIENT"], capability: "document.confirm.own", secondaryApproval: false,
    emits: ["case.status.changed"], clientCopy: "Check the extracted details and correct anything that is wrong.", clientVisible: true, slaDays: 3,
  },
  {
    key: "DATA_APPROVAL_PRIMARY", label: "Review data (advisor)", caseState: "DATA_SUBMITTED", kind: "GATE",
    actors: ["RM", "SENIOR_RM"], capability: "case.approve.data", secondaryApproval: false,
    emits: ["case.data.approved", "case.data.rejected"], clientCopy: "Your advisor is reviewing your details.", clientVisible: true, slaDays: 2,
  },
  {
    key: "DATA_APPROVAL_SECONDARY", label: "Secondary approval of data", caseState: "DATA_APPROVED", kind: "GATE",
    actors: ["SENIOR_RM"], capability: "case.approve.data.secondary", secondaryApproval: false,
    emits: ["case.data.approved"], clientCopy: "A senior advisor has countersigned your details.", clientVisible: true, slaDays: 2,
  },
  {
    key: "SCREENING", label: "Screening (KYC / AML)", caseState: "DATA_APPROVED", kind: "AUTOMATION",
    actors: ["RM", "SENIOR_RM"], capability: "screening.run", secondaryApproval: false,
    emits: ["kyc.screened"], clientCopy: "We are completing our regulatory checks.", clientVisible: false, slaDays: 5,
  },
  {
    key: "SERVICE_SELECTED", label: "Choose your programme", caseState: "SERVICE_SELECTED", kind: "ACTION",
    actors: ["CLIENT"], capability: "service.select.own", secondaryApproval: false,
    emits: ["case.service.selected"], clientCopy: "Select the programme that suits you.", clientVisible: true, slaDays: 7,
  },
  {
    key: "SERVICE_APPROVED", label: "Approve the chosen programme", caseState: "SERVICE_APPROVED", kind: "GATE",
    actors: ["RM", "SENIOR_RM"], capability: "case.approve.service", secondaryApproval: true,
    emits: ["case.service.approved", "case.service.rejected"], clientCopy: "We are confirming your chosen programme is the right fit.", clientVisible: true, slaDays: 2,
  },
  {
    key: "WELCOME_SENT", label: "Welcome aboard", caseState: "SERVICE_APPROVED", kind: "NOTICE",
    actors: [], capability: null, secondaryApproval: false,
    emits: ["message.received"], clientCopy: "Welcome aboard — here is what happens next.", clientVisible: true, slaDays: 1,
  },
  {
    key: "DOCS_REQUESTED", label: "Document request raised", caseState: "DOCS_REQUESTED", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "request.create", secondaryApproval: false,
    emits: ["request.created"], clientCopy: "We have requested the documents we need from you.", clientVisible: true, slaDays: 2,
  },
  {
    key: "DOCUMENT_REVIEW", label: "Review each document", caseState: "DOCS_REQUESTED", kind: "GATE",
    actors: ["RM", "SENIOR_RM"], capability: "document.review", secondaryApproval: false,
    emits: ["document.approved", "document.rejected", "document.changes_requested"], clientCopy: "Your advisor is checking each document you submitted.", clientVisible: true, slaDays: 3,
  },
  {
    key: "ADDITIONAL_DOCS", label: "Additional document request", caseState: "DOCS_REQUESTED", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "request.create", secondaryApproval: false,
    emits: ["request.created"], clientCopy: "We need one or two more documents from you.", clientVisible: true, slaDays: 5,
  },
  {
    key: "IN_PROGRESS", label: "File preparation", caseState: "IN_PROGRESS", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "case.read.all", secondaryApproval: false,
    emits: ["case.status.changed"], clientCopy: "We are preparing your filing.", clientVisible: true, slaDays: 10,
  },
  {
    key: "DISPATCHED", label: "Dispatch to the authority", caseState: "DISPATCHED", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "dispatch.create", secondaryApproval: false,
    emits: ["dispatch.created"], clientCopy: "Your file has been sent to the authority.", clientVisible: true, slaDays: 3,
  },
  {
    key: "FOLLOW_UP", label: "Authority follow-up", caseState: "FOLLOW_UP", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "followup.schedule", secondaryApproval: false,
    emits: ["reminder.created", "reminder.due"], clientCopy: "We are following up with the authority on your behalf.", clientVisible: true, slaDays: 21,
  },
  {
    key: "APPROVED_IN_PRINCIPLE", label: "Approval in principle received", caseState: "APPROVED_IN_PRINCIPLE", kind: "GATE",
    actors: ["RM", "SENIOR_RM"], capability: "letter.upload", secondaryApproval: false,
    emits: ["case.status.changed", "approval.letter.uploaded"], clientCopy: "Good news — the authority has approved your application in principle.", clientVisible: true, slaDays: 7,
  },
  {
    key: "COMPLETED", label: "Completion", caseState: "COMPLETED", kind: "ACTION",
    actors: ["RM", "SENIOR_RM"], capability: "case.complete", secondaryApproval: false,
    emits: ["case.status.changed"], clientCopy: "Your application is complete.", clientVisible: true, slaDays: 5,
  },
];

export const STAGE_KEYS: readonly string[] = LIFECYCLE_STAGES.map((s) => s.key);

export function stageByKey(key: string): LifecycleStage | undefined {
  return LIFECYCLE_STAGES.find((s) => s.key === key);
}

/** Stages for a given case state, in lifecycle order. */
export function stagesForCaseState(caseState: string): LifecycleStage[] {
  return LIFECYCLE_STAGES.filter((s) => s.caseState === caseState);
}

/** What the CLIENT sees on their timeline, in order. */
export function clientTimeline(): LifecycleStage[] {
  return LIFECYCLE_STAGES.filter((s) => s.clientVisible);
}

/** Stages that require a second, distinct approver. */
export function secondaryApprovalStages(): LifecycleStage[] {
  return LIFECYCLE_STAGES.filter((s) => s.secondaryApproval);
}

/** Total expected working days across the lifecycle (a naive lead-time estimate). */
export function expectedLeadTimeDays(): number {
  return LIFECYCLE_STAGES.reduce((sum, s) => sum + s.slaDays, 0);
}

// ───────────────────────────── SLA clocks ─────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * The lifecycle stage a case is currently IN, given its `CaseState`.
 *
 * A single `CaseState` maps to several lifecycle stages (e.g. `ONBOARDING`
 * covers PROFILE_CREATED → IDENTITY_UPLOADED → OCR_EXTRACTED), and nothing on
 * `Case` persists which one. `command` from the status history — the stage key
 * the transition was recorded with, when present — disambiguates exactly; absent
 * that, we take the LAST stage of the state's group, i.e. the furthest the case
 * can be within that state. This is a deliberate, documented approximation.
 */
export function stageForCaseStatus(status: string, command?: string | null): LifecycleStage | undefined {
  const candidates = stagesForCaseState(status);
  if (candidates.length === 0) return undefined;
  if (command) {
    const exact = candidates.find((s) => s.key === command);
    if (exact) return exact;
  }
  return candidates[candidates.length - 1];
}

export type SlaCaseInput = {
  status: string;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  /** Newest-first or oldest-first; only the latest matching entry is used. */
  statusHistory?: ReadonlyArray<{ to: string; command?: string | null; createdAt: Date | string }>;
};

export type SlaEvaluation = {
  stageKey: string;
  stageLabel: string;
  slaDays: number;
  /** When the case entered the current stage (best available signal). */
  enteredAt: Date;
  ageDays: number;
  dueAt: Date;
  /** Days left before the SLA is breached; negative once overdue. */
  remainingDays: number;
  overdue: boolean;
};

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Canon SLA per stage key, derived from the stage table itself, so the settings
 * default an operator sees and the value used when no override is stored can
 * never drift apart.
 */
export const SLA_DAYS_CANON: Record<string, number> = Object.fromEntries(
  LIFECYCLE_STAGES.map((s) => [s.key, s.slaDays]),
);

/**
 * Measure a case against its current stage's SLA.
 *
 * `enteredAt` prefers the latest status-history entry that landed on the current
 * status (the real stage-entry time), falling back to `updatedAt` then
 * `createdAt` when no history is available. Pure — no Prisma, no clock beyond the
 * injected `now` — so it is trivially testable and safe to call from any render.
 *
 * `slaOverrides` maps a stage key to an operator-set day count. It is passed in
 * rather than read here because this module is deliberately Prisma-free: the
 * caller loads the setting and hands it over. A stage with no override keeps its
 * canon value, so a partial configuration stays safe.
 */
export function slaForCase(
  c: SlaCaseInput,
  now: Date = new Date(),
  slaOverrides?: Record<string, number> | null,
): SlaEvaluation | null {
  const history = c.statusHistory ?? [];
  const matching = history.filter((h) => h.to === c.status);
  const latest = matching.length > 0 ? matching[matching.length - 1] : undefined;
  const stage = stageForCaseStatus(c.status, latest?.command ?? null);
  if (!stage) return null;

  const override = slaOverrides?.[stage.key];
  const slaDays = typeof override === "number" && Number.isFinite(override) && override > 0 ? override : stage.slaDays;

  const enteredAt = asDate(latest?.createdAt) ?? asDate(c.updatedAt) ?? asDate(c.createdAt) ?? now;
  const ageDays = Math.max(0, (now.getTime() - enteredAt.getTime()) / MS_PER_DAY);
  const dueAt = new Date(enteredAt.getTime() + slaDays * MS_PER_DAY);
  return {
    stageKey: stage.key,
    stageLabel: stage.label,
    slaDays,
    enteredAt,
    ageDays,
    dueAt,
    remainingDays: slaDays - ageDays,
    overdue: ageDays > slaDays,
  };
}
