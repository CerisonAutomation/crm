/**
 * RFI loop domain — threaded Q&A per case (ADR-005).
 *
 * Pure, Prisma-free: no framework imports, safe to import from client
 * components, routes and unit specs alike. Persistence lives behind the
 * RfiStore port (src/lib/ports/rfi.ts); orchestration in
 * src/lib/services/rfi.ts; the Prisma adapter at src/lib/adapters/.
 *
 * Model:
 * - One RfiThread per question-line on a case. Staff ask, the client answers
 *   in-portal; every turn is a row, never an overwrite (append-only turns).
 * - Turns alternate QUESTION (staff to client) / ANSWER (client to staff).
 *   NOTE turns are staff-side working notes on the thread; SYSTEM turns are
 *   machine records (opened / escalated / linked).
 * - Each QUESTION arms an SLA clock (default 48h). An ANSWER disarms it. A
 *   follow-up QUESTION re-arms it. Past-due OPEN threads escalate via the
 *   existing deadline runner (reminders sweep), never via a second notifier.
 * - A thread may link to a DocumentRequest (the upload-it-here pointer);
 *   answering never fulfils the request itself — fulfilment stays with the
 *   document-request lifecycle (FS-10), the link is navigational.
 */

import { DomainError } from "@/lib/domain/states";

/** Thread lifecycle. OPEN = awaiting the client; ANSWERED = client replied, staff to review/close. */
export const RFI_STATUSES = ["OPEN", "ANSWERED", "CLOSED", "ESCALATED"] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

/** Turn kinds. Only QUESTION arms the SLA; only ANSWER disarms it. */
export const RFI_TURN_KINDS = ["QUESTION", "ANSWER", "NOTE", "SYSTEM"] as const;
export type RfiTurnKind = (typeof RFI_TURN_KINDS)[number];

/** Default response SLA for one question, hours (Passport Nexus pattern: 48h). */
export const RFI_DEFAULT_SLA_HOURS = 48;

/** Closed cases never accept new turns. */
const TERMINAL_CASE_STATES: ReadonlySet<string> = new Set(["COMPLETED", "CANCELLED"]);

const THREAD_TRANSITIONS: Record<RfiStatus, RfiStatus[]> = {
  // OPEN + client answer -> ANSWERED; staff follow-up re-arms -> stays OPEN.
  OPEN: ["ANSWERED", "CLOSED", "ESCALATED"],
  // Staff closes, asks a follow-up (-> OPEN), or the runner escalates a stale ANSWERED thread.
  ANSWERED: ["OPEN", "CLOSED", "ESCALATED"],
  // Escalation is a routing flag, not a grave: answer/close still land.
  ESCALATED: ["ANSWERED", "CLOSED", "OPEN"],
  CLOSED: [],
};

export function assertRfiTransition(from: RfiStatus, to: RfiStatus): void {
  const legal = THREAD_TRANSITIONS[from];
  if (!legal || !legal.includes(to)) {
    throw new DomainError("Illegal RFI transition " + from + " -> " + to);
  }
}

export interface RfiTurn {
  id: string;
  threadId: string;
  kind: RfiTurnKind;
  body: string;
  authorId: string | null;
  authorRole: string | null;
  authorLabel: string;
  createdAt: string;
}

export interface RfiThread {
  id: string;
  orgId: string;
  caseId: string;
  subject: string;
  status: RfiStatus;
  /** RM accountable for chasing this thread (User id). Falls back to the case rmAssignedId. */
  ownerId: string | null;
  /** Optional navigational link to a document request (upload-it-here pointer). */
  documentRequestId: string | null;
  /** Armed by the latest QUESTION; null once answered. */
  slaDueAt: string | null;
  slaHours: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  turns: RfiTurn[];
}

export type NewThreadInput = {
  subject: unknown;
  body: unknown;
  documentRequestId?: unknown;
  slaHours?: unknown;
  ownerId?: unknown;
};

export type NewTurnInput = {
  kind: unknown;
  body: unknown;
};

/** Trimmed text or null when blank — validation reports the field, never throws. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

/** Unhappy-first validation for opening a thread. Returns field errors, [] when valid. */
export function validateNewThread(input: NewThreadInput): string[] {
  const errors: string[] = [];
  const subject = cleanText(input.subject, 160);
  if (!subject) errors.push("subject is required");
  const body = cleanText(input.body, 4000);
  if (!body) errors.push("body is required (the opening question)");
  else if (body.length < 10) errors.push("body must be at least 10 characters");
  if (input.documentRequestId !== undefined && input.documentRequestId !== null) {
    if (typeof input.documentRequestId !== "string" || input.documentRequestId.trim() === "") {
      errors.push("documentRequestId must be a non-empty id when provided");
    }
  }
  if (input.slaHours !== undefined && input.slaHours !== null) {
    if (typeof input.slaHours !== "number" || !Number.isFinite(input.slaHours) || input.slaHours < 1 || input.slaHours > 24 * 30) {
      errors.push("slaHours must be a number between 1 and 720");
    }
  }
  if (input.ownerId !== undefined && input.ownerId !== null) {
    if (typeof input.ownerId !== "string" || input.ownerId.trim() === "") {
      errors.push("ownerId must be a non-empty id when provided");
    }
  }
  return errors;
}

/** Unhappy-first validation for appending a turn. */
export function validateNewTurn(input: NewTurnInput): string[] {
  const errors: string[] = [];
  if (input.kind !== "QUESTION" && input.kind !== "ANSWER" && input.kind !== "NOTE") {
    errors.push("kind must be one of QUESTION, ANSWER, NOTE");
  }
  const body = cleanText(input.body, 4000);
  if (!body) errors.push("body is required");
  else if (body.length < 2) errors.push("body must be at least 2 characters");
  return errors;
}

export function assertCaseAcceptsRfi(caseStatus: string): void {
  if (TERMINAL_CASE_STATES.has(caseStatus)) {
    throw new DomainError("This case is closed and no longer accepts RFI turns", 409);
  }
}

/**
 * Who may author which turn kind. Staff (RM/SENIOR_RM/ADMIN) ask, answer on
 * behalf, note and close; the CLIENT answers their own threads only — they
 * never open, re-question or close. AUDITOR is read-only everywhere.
 * Returns null when allowed, otherwise the denial reason (never throws: the
 * route maps it to 403 with the audit trail intact).
 */
export function authorisationForTurn(
  role: string,
  kind: RfiTurnKind | "CLOSE" | "OPEN" | "ESCALATE",
  isCaseOwner: boolean,
): string | null {
  if (role === "ADMIN" || role === "SENIOR_RM" || role === "RM") return null;
  if (role === "CLIENT") {
    if (!isCaseOwner) return "clients answer only their own case threads";
    if (kind === "ANSWER") return null;
    return "clients answer RFI threads — asking and closing is the desk job";
  }
  return role + " holds no RFI write rights";
}

/** Status the thread lands in after an accepted turn kind. */
export function statusAfterTurn(from: RfiStatus, kind: RfiTurnKind): RfiStatus {
  switch (kind) {
    case "QUESTION":
      // A follow-up re-arms the chase on ANSWERED/ESCALATED threads too.
      assertRfiTransition(from, "OPEN");
      return "OPEN";
    case "ANSWER":
      // A second answer adds information — it stays ANSWERED, no transition.
      if (from === "ANSWERED") return "ANSWERED";
      assertRfiTransition(from, "ANSWERED");
      return "ANSWERED";
    case "NOTE":
    case "SYSTEM":
      return from;
  }
}

/** SLA deadline for a question asked at askedAt (+ slaHours, default 48h). */
export function slaDueAt(askedAt: Date, slaHours = RFI_DEFAULT_SLA_HOURS): string {
  return new Date(askedAt.getTime() + slaHours * 3600000).toISOString();
}

/**
 * True when the client owes an answer and the clock ran out: status OPEN with
 * an armed, past-due SLA. ANSWERED threads are staff debt, not client debt —
 * they age into the RM queue, never into auto-escalation.
 */
export function isSlaBreached(thread: Pick<RfiThread, "status" | "slaDueAt">, now: Date = new Date()): boolean {
  if (thread.status !== "OPEN" || !thread.slaDueAt) return false;
  return new Date(thread.slaDueAt).getTime() <= now.getTime();
}

/** Whole hours past the SLA deadline (0 when not breached) — the chase priority. */
export function slaOverdueHours(thread: Pick<RfiThread, "status" | "slaDueAt">, now: Date = new Date()): number {
  if (!isSlaBreached(thread, now) || !thread.slaDueAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(thread.slaDueAt).getTime()) / 3600000));
}

/** Chronological turns — the thread renders oldest-first, newest at the composer. */
export function orderedTurns(turns: RfiTurn[]): RfiTurn[] {
  return [...turns].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** The question the client still owes an answer to (latest QUESTION), if any. */
export function pendingQuestion(thread: Pick<RfiThread, "turns">): RfiTurn | null {
  const questions = orderedTurns(thread.turns).filter((t) => t.kind === "QUESTION");
  return questions.length > 0 ? questions[questions.length - 1] : null;
}
