/**
 * Domain state machines — legal transition tables.
 * Every consequential transition stores actor, reason, correlationId and source command.
 * Illegal transitions throw DomainError (tested via API 422 responses).
 */

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 422, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

// ── Case lifecycle ──
export const CASE_STATES = [
  "ONBOARDING",
  "DATA_SUBMITTED",
  "DATA_APPROVED",
  "SERVICE_SELECTED",
  "SERVICE_APPROVED",
  "DOCS_REQUESTED",
  "IN_PROGRESS",
  "DISPATCHED",
  "FOLLOW_UP",
  "APPROVED_IN_PRINCIPLE",
  "FINAL_IDENTITY",
  "COMPLETED",
  "CANCELLED",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const CASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
  ONBOARDING: ["DATA_SUBMITTED", "CANCELLED"],
  DATA_SUBMITTED: ["DATA_APPROVED", "ONBOARDING", "CANCELLED"], // ONBOARDING = client corrected data
  DATA_APPROVED: ["SERVICE_SELECTED", "CANCELLED"],
  SERVICE_SELECTED: ["SERVICE_APPROVED", "DATA_APPROVED", "CANCELLED"],
  SERVICE_APPROVED: ["DOCS_REQUESTED", "CANCELLED"],
  DOCS_REQUESTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["DISPATCHED", "DOCS_REQUESTED", "CANCELLED"],
  DISPATCHED: ["FOLLOW_UP", "CANCELLED"],
  FOLLOW_UP: ["DISPATCHED", "APPROVED_IN_PRINCIPLE", "CANCELLED"],
  APPROVED_IN_PRINCIPLE: ["FINAL_IDENTITY", "CANCELLED"],
  FINAL_IDENTITY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertCaseTransition(from: string, to: string) {
  const legal = CASE_TRANSITIONS[from as CaseState];
  if (!legal || !legal.includes(to as CaseState)) {
    throw new DomainError(`Illegal case transition ${from} → ${to}`);
  }
}

// ── Document lifecycle ──
export type DocumentState =
  | "UPLOADED"
  | "OCR_PROCESSING"
  | "OCR_PROCESSED"
  | "CLIENT_CONFIRMED"
  | "IN_REVIEW"
  | "RM_APPROVED"
  | "RM_REJECTED"
  | "CHANGES_REQUESTED";

export const DOCUMENT_TRANSITIONS: Record<DocumentState, DocumentState[]> = {
  UPLOADED: ["OCR_PROCESSING", "CLIENT_CONFIRMED"],
  OCR_PROCESSING: ["OCR_PROCESSED", "UPLOADED"], // UPLOADED = OCR failed, retry
  OCR_PROCESSED: ["CLIENT_CONFIRMED"],
  CLIENT_CONFIRMED: ["IN_REVIEW", "OCR_PROCESSING"], // re-OCR on correction
  IN_REVIEW: ["RM_APPROVED", "RM_REJECTED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: ["CLIENT_CONFIRMED"],
  RM_REJECTED: ["CLIENT_CONFIRMED"],
  RM_APPROVED: [],
};

export function assertDocumentTransition(from: string, to: string) {
  const legal = DOCUMENT_TRANSITIONS[from as DocumentState];
  if (!legal || !legal.includes(to as DocumentState)) {
    throw new DomainError(`Illegal document transition ${from} → ${to}`);
  }
}

// ── Workflow lifecycle ──
export const WORKFLOW_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED", "DISABLED"],
  PUBLISHED: ["DISABLED"],
  DISABLED: ["PUBLISHED"], // re-enable republishes latest version
};

// ── Run lifecycle ──
export const RUN_TRANSITIONS: Record<string, string[]> = {
  RUNNING: ["WAITING_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"],
  FAILED: ["RUNNING"], // retry / replay
  SUCCEEDED: [],
  CANCELLED: [],
};

// ── Lane Page lifecycle ──
export const PAGE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["UNPUBLISHED"],
  UNPUBLISHED: ["PUBLISHED"],
};

// ── Dispatch lifecycle (DHL sandbox tracking) ──
export const DISPATCH_TRANSITIONS: Record<string, string[]> = {
  PREPARED: ["DISPATCHED"],
  DISPATCHED: ["IN_TRANSIT"],
  IN_TRANSIT: ["DELIVERED"],
  DELIVERED: [],
};

// ── Notification / role helpers ──
export const ROLES = ["CLIENT", "RM", "SENIOR_RM", "ADMIN", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Capabilities shared by the two staff-desk roles.
 *
 * Kept as ONE list deliberately: a senior advisor is exactly an advisor PLUS
 * the countersigning rights below, so listing the desk's ~30 capabilities twice
 * would let RM and SENIOR_RM drift apart silently.
 */
const STAFF_DESK_CAPABILITIES: readonly string[] = [
  "case.read.assigned",
  "case.read.all",
  "case.approve.data",
  "case.approve.service",
  "case.assign",
  "case.edit.client",
  "document.read.all",
  "document.review",
  "request.create",
  "dispatch.create",
  "followup.schedule",
  "letter.upload",
  "comment.create.all",
  "message.read.all",
  "notification.read.own",
  "run.read",
  "run.approve",
  // Managing a run's LIFECYCLE (retry / cancel) is a WRITE: retry starts a new
  // run that executes node side effects, and cancel mutates run state. It is
  // deliberately kept out of `run.read`, which the read-only AUDITOR holds — a
  // read capability must never authorise a state change.
  "run.manage",
  "page.read",
  "template.read",
  "workflow.read",
  // operational ledger + lifecycle controls (deadline ledger, obligations,
  // consultations, triage, bookings, case closure)
  "renewal.write",
  "consultation.write",
  "reminder.manage",
  "triage.run",
  "screening.run",
  "booking.create.own",
  "booking.manage",
  "case.complete",
  // compliance intake + eligibility screening: reviewing the client's
  // source-of-funds questionnaire, and recording a rule-based pre-scan against
  // a case the desk may read.
  "sof.review",
  "prescan.run",
  // internal staff teams + meetings (internal comms; CLIENT/AUDITOR excluded)
  "team.read",
  "team.message",
  "meeting.start",
  // Structured RFI loop (ADR-005): the desk asks/answers/closes/escalates and
  // reads every thread; clients answer their own threads in-portal.
  "rfi.manage",
  "rfi.read.all",
  // DESK-SCOPED SETTINGS WRITES. The RM desk may READ the `operations` and `rm`
  // sections but, by default, could not EDIT the settings that govern its own
  // desk (dispatch destinations, follow-up weeks, upload caps, review reasons) —
  // only ADMIN could, via the wildcard. This capability opens exactly those two
  // desk-owned sections to RM/SENIOR_RM and nothing else: it is deliberately
  // narrower than `settings.write`, which stays ADMIN-ONLY and still gates
  // `labels` and every future section (see settings registry writeRoles +
  // sectionWriteCapability). Section ownership is enforced in the route by
  // requiring BOTH this capability AND the section's own writeRoles.
  "settings.desk.write",
  // NOT here: the builders (workflow.write / page.write) are ADMIN-ONLY by
  // directive — RM/SENIOR_RM consume published workflows & pages, never author.
  // `settings.write` is likewise ADMIN-ONLY: opening a section to the desk is a
  // deliberate per-section act (writeRoles), never a blanket grant.
];

/** Rights held ONLY by a SENIOR_RM, on top of the desk baseline. */
const SENIOR_ONLY_CAPABILITIES: readonly string[] = [
  // Secondary (countersigning) approvals — the TWO-PERSON RULE. An RM proposes,
  // a SENIOR_RM signs off; holding the primary capability is deliberately NOT
  // enough to countersign, for data AND for the programme choice.
  "case.approve.data.secondary",
  "case.approve.service.secondary",
  // Four-eyes for the approval-in-principle letter — the letter is released to
  // the client only after a senior countersignature.
  "case.approve.letter.secondary",
  // Dual-control on money (BILL annex, R5): invoices above the dual-control
  // threshold need a DISTINCT second approver holding finance.approve before
  // they may be SENT/PAID. finance.write proposes; finance.approve disposes.
  // (finance.write itself is ADMIN-held via "*"; the desk never self-approves.)
  "finance.approve",
  // Appeal decisions (§24.5): resolving an appeal needs a senior who is none
  // of appellant / original maker / original checker (self-dealing barred).
  "decision.resolve",
  // Party duplicate review + merge (CRM slice): near-irreversible history
  // moves, so the desk sees read-only review state and only seniors (and
  // ADMIN via "*") may confirm, dismiss or execute. Four-eyes itself is
  // enforced in the use-cases via reporter-vs-actor, not by this flag alone.
  "party.merge",
];

/** Citizen Lane application case & work item capabilities (RM desk). */
const CITIZEN_LANE_DESK_CAPABILITIES: readonly string[] = [
  // Application case lifecycle — desk owns creation and management
  "case.create",
  "case.edit",
  // case.delete is destructive; restrict to ADMIN only (via wildcard)
  // Work item (task) lifecycle
  "task.create",
  "task.manage",
];

/** Deny-by-default capability matrix. */
export const CAPABILITIES: Record<Role, string[]> = {
  CLIENT: [
    "case.read.own",
    "document.upload.own",
    "document.read.own",
    "document.confirm.own",
    "request.read.own",
    "request.fulfil.own",
    "service.select.own",
    "letter.read.own",
    "comment.create.own",
    "message.read.own",
    "dispatch.read.own",
    "notification.read.own",
    "ai.feedback.own",
    "booking.create.own",
    // the client is the only party who can answer their own source-of-funds
    // questionnaire, and may run the eligibility pre-scan on their own case.
    "sof.submit.own",
    "prescan.self.own",
    // ADR-006: the client confirms their own renewal dates in-portal.
    "renewal.confirm.own",
    // ADR-005: read own case threads, answer the desk questions in-portal.
    "rfi.read.own",
    "rfi.answer.own",
  ],
  RM: [...STAFF_DESK_CAPABILITIES, "ai.feedback.all", ...CITIZEN_LANE_DESK_CAPABILITIES],
  SENIOR_RM: [
    ...STAFF_DESK_CAPABILITIES,
    "ai.feedback.all",
    ...CITIZEN_LANE_DESK_CAPABILITIES,
    ...SENIOR_ONLY_CAPABILITIES,
  ],
  ADMIN: [
    "*",
    // Explicit ADMIN-only gate for the administration console API surface
    // (/api/admin/*). Deny-by-default: no other role lists it, so an RM can
    // never escalate an account, toggle flags or rotate connections.
    "admin.manage",
  ],
  AUDITOR: [
    "audit.read",
    "case.read.all",
    "document.read.all",
    "rfi.read.all",
    "run.read",
    "workflow.read",
    "page.read",
    "notification.read.own",
  ],
};

export function can(role: Role, capability: string): boolean {
  const caps = CAPABILITIES[role] ?? [];
  return caps.includes("*") || caps.includes(capability);
}

export const DOC_TYPES = [
  "PASSPORT",
  "NATIONAL_ID",
  "POLICE_RECORD",
  "CERTIFICATE_OF_REGISTRATION",
  "BANK_STATEMENT",
  "OTHER",
] as const;

export const DOC_TYPE_LABELS: Record<string, string> = {
  PASSPORT: "Passport",
  NATIONAL_ID: "National ID",
  POLICE_RECORD: "Police Record",
  CERTIFICATE_OF_REGISTRATION: "Certificate of Registration",
  BANK_STATEMENT: "Bank Statement",
  OTHER: "Other Document",
};

export function caseStatusLabel(s: string): string {
  const map: Record<string, string> = {
    ONBOARDING: "Onboarding",
    DATA_SUBMITTED: "Data submitted",
    DATA_APPROVED: "Data approved",
    SERVICE_SELECTED: "Service selected",
    SERVICE_APPROVED: "Service approved",
    DOCS_REQUESTED: "Documents requested",
    IN_PROGRESS: "In progress",
    DISPATCHED: "Dispatched to authority",
    FOLLOW_UP: "Authority follow-up",
    APPROVED_IN_PRINCIPLE: "Approved in principle",
    FINAL_IDENTITY: "Final identity verification",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };
  return map[s] ?? s;
}

export function docStatusLabel(s: string): string {
  const map: Record<string, string> = {
    UPLOADED: "Uploaded",
    OCR_PROCESSING: "Reading (OCR)",
    OCR_PROCESSED: "Awaiting your confirmation",
    CLIENT_CONFIRMED: "Confirmed by client",
    IN_REVIEW: "Under RM review",
    RM_APPROVED: "Approved",
    RM_REJECTED: "Rejected",
    CHANGES_REQUESTED: "Changes requested",
  };
  return map[s] ?? s;
}
