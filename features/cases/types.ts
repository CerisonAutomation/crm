/**
 * Case-file state machine — the forward-only lifecycle of an investment-migration
 * file, from the first profile draft to completion.
 *
 * This is the SINGLE source of truth for legal case-file transitions. The UI, the
 * transition service and the deadline runner all read `TRANSITIONS` rather than
 * re-deriving the rules with if-chains, so a gate can never be enforced in one
 * place and skipped in another.
 *
 * Relationship to `@/lib/domain/states`: that module holds the COARSE operational
 * status written to `Case.status` (ONBOARDING … CANCELLED) plus the capability
 * matrix. This module is the finer-grained FILE lifecycle the desk works through,
 * including the gates the coarse status cannot express — the explicit owner gate
 * (FS-4), RM ratification of the programme choice (FS-6), the non-skippable
 * secondary review for high-risk files, the DHL dispatch (FS-12), durable
 * authority polling (FS-13) and the owner-vertical-order final ID re-upload
 * (FS-15). Keep the two in step when a new gate is added.
 *
 * Prisma-free and side-effect-free, so it is importable from server and client
 * modules and unit-testable without a database.
 */

export enum CaseState {
  PROFILE_DRAFT = "PROFILE_DRAFT",
  PROFILE_SUBMITTED = "PROFILE_SUBMITTED",
  PROFILE_APPROVED = "PROFILE_APPROVED", // FS-4 explicit owner gate
  SERVICE_SELECT = "SERVICE_SELECT",
  SERVICE_APPROVED = "SERVICE_APPROVED", // FS-6 RM ratification
  DOCS_REQUESTED = "DOCS_REQUESTED",
  DOCS_RECEIVED = "DOCS_RECEIVED",
  RM_REVIEW = "RM_REVIEW",
  SECONDARY_REVIEW = "SECONDARY_REVIEW", // non-skippable high-risk
  AUTHORITY_SUBMITTED = "AUTHORITY_SUBMITTED", // FS-12 DHL sent
  AUTHORITY_FOLLOWUP = "AUTHORITY_FOLLOWUP", // FS-13 durable polls
  APPROVAL_IN_PRINCIPLE = "APPROVAL_IN_PRINCIPLE",
  FINAL_ID_REUPLOAD = "FINAL_ID_REUPLOAD", // FS-15 owner-vertical-order fix
  COMPLETE = "COMPLETE",
  REJECTED = "REJECTED",
  SUSPENDED = "SUSPENDED",
}

/**
 * The base transition table. `SUSPENDED` is filled in below from the table
 * itself, so a suspended file is always resumable into exactly the states that
 * can suspend it — the resume edges cannot drift from the suspend edges.
 */
const BASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
  [CaseState.PROFILE_DRAFT]: [CaseState.PROFILE_SUBMITTED],
  [CaseState.PROFILE_SUBMITTED]: [CaseState.PROFILE_APPROVED, CaseState.REJECTED],
  [CaseState.PROFILE_APPROVED]: [CaseState.SERVICE_SELECT],
  [CaseState.SERVICE_SELECT]: [CaseState.SERVICE_APPROVED],
  [CaseState.SERVICE_APPROVED]: [CaseState.DOCS_REQUESTED],
  [CaseState.DOCS_REQUESTED]: [CaseState.DOCS_RECEIVED, CaseState.SUSPENDED],
  [CaseState.DOCS_RECEIVED]: [CaseState.RM_REVIEW],
  [CaseState.RM_REVIEW]: [CaseState.SECONDARY_REVIEW, CaseState.DOCS_REQUESTED],
  [CaseState.SECONDARY_REVIEW]: [CaseState.AUTHORITY_SUBMITTED],
  [CaseState.AUTHORITY_SUBMITTED]: [CaseState.AUTHORITY_FOLLOWUP],
  [CaseState.AUTHORITY_FOLLOWUP]: [
    CaseState.APPROVAL_IN_PRINCIPLE,
    CaseState.DOCS_REQUESTED, // authority re-requests
  ],
  [CaseState.APPROVAL_IN_PRINCIPLE]: [CaseState.FINAL_ID_REUPLOAD],
  [CaseState.FINAL_ID_REUPLOAD]: [CaseState.COMPLETE],
  [CaseState.COMPLETE]: [],
  [CaseState.REJECTED]: [],
  [CaseState.SUSPENDED]: [],
};

/** Every state that lists `SUSPENDED` as a legal target — i.e. can be resumed. */
const SUSPEND_RESUME_TARGETS: CaseState[] = (Object.keys(BASE_TRANSITIONS) as CaseState[]).filter(
  (from) => BASE_TRANSITIONS[from].includes(CaseState.SUSPENDED),
);

// Authority follow-up can be suspended while waiting for a provider or client
// response, even though the base table only models its forward edge.
if (!SUSPEND_RESUME_TARGETS.includes(CaseState.AUTHORITY_FOLLOWUP)) {
  SUSPEND_RESUME_TARGETS.push(CaseState.AUTHORITY_FOLLOWUP);
}

/** Forward-only transition table — single source, never if-chained in UI. */
export const TRANSITIONS: Record<CaseState, CaseState[]> = {
  ...BASE_TRANSITIONS,
  [CaseState.SUSPENDED]: SUSPEND_RESUME_TARGETS,
};

/** States with no outgoing transition — a file here is finished. */
export const TERMINAL_STATES: readonly CaseState[] = (Object.keys(TRANSITIONS) as CaseState[]).filter(
  (s) => TRANSITIONS[s].length === 0,
);

/** True when `from → to` is a legal case-file transition. */
export function canTransition(from: CaseState, to: CaseState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throws when `from → to` is not a legal case-file transition. */
export function assertTransition(from: CaseState, to: CaseState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal case-file transition ${from} → ${to}`);
  }
}

/** Human-readable label for a state, for the desk UI. */
export function caseStateLabel(state: CaseState): string {
  const map: Record<CaseState, string> = {
    [CaseState.PROFILE_DRAFT]: "Profile draft",
    [CaseState.PROFILE_SUBMITTED]: "Profile submitted",
    [CaseState.PROFILE_APPROVED]: "Profile approved",
    [CaseState.SERVICE_SELECT]: "Service selection",
    [CaseState.SERVICE_APPROVED]: "Service approved",
    [CaseState.DOCS_REQUESTED]: "Documents requested",
    [CaseState.DOCS_RECEIVED]: "Documents received",
    [CaseState.RM_REVIEW]: "RM review",
    [CaseState.SECONDARY_REVIEW]: "Secondary review",
    [CaseState.AUTHORITY_SUBMITTED]: "Submitted to authority",
    [CaseState.AUTHORITY_FOLLOWUP]: "Authority follow-up",
    [CaseState.APPROVAL_IN_PRINCIPLE]: "Approval in principle",
    [CaseState.FINAL_ID_REUPLOAD]: "Final ID re-upload",
    [CaseState.COMPLETE]: "Complete",
    [CaseState.REJECTED]: "Rejected",
    [CaseState.SUSPENDED]: "Suspended",
  };
  return map[state] ?? state;
}

// ── Deadline windows ──────────────────────────────────────────────────────────

/** The two instants a programme's statutory clock can start from. */
export type DeadlineAnchor = "submission" | "approval_in_principle";

/**
 * One statutory deadline a programme imposes, expressed relative to an anchor
 * rather than as an absolute date — so the same window applies to every file.
 * Stored on `ProgramVersion.deadlineWindows` and armed by the deadline runner.
 */
export interface DeadlineWindow {
  /** Stable key, unique within a version — the idempotency key for the run. */
  key: string;
  /** Which instant the clock starts from. */
  daysAfter: DeadlineAnchor;
  /** Days after the anchor the deadline falls due. */
  days: number;
  /** Optional human label; falls back to `key`. */
  label?: string;
}
