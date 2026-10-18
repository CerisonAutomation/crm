/**
 * Node catalog — pure metadata for every workflow node ("chunk").
 *
 * This file is CLIENT-SAFE (no server imports): the Workflow Studio imports
 * it directly to render the palette and inspector, and the server registry
 * in executors.ts binds the same pieceKeys to their executors. Adding a node
 * = add a catalog entry + an executor; nothing else changes.
 */
import { CASE_STATES } from "@/lib/domain/states";

export type NodeCategory =
  | "Trigger"
  | "Logic"
  | "Communication"
  | "CRM"
  | "Approval"
  | "AI"
  | "Compliance";

export type NodeFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean";

export type NodeField = {
  key: string;
  label: string;
  type: NodeFieldType;
  options?: string[];
  placeholder?: string;
  help?: string;
  required?: boolean;
};

export type NodeMeta = {
  pieceKey: string;
  name: string;
  category: NodeCategory;
  description: string;
  fields: NodeField[];
  /** Context keys this node writes (surfaced in the studio as "outputs"). */
  outputs: string[];
};

// ───────────────────────── node contracts (Activepieces-style) ─────────────────────────
//
// Every node carries a typed execution contract so the engine, the studio and
// external callers (MCP `run_node`) agree on what a node needs and promises:
// versioned metadata (graphs recorded the contract version at publish time),
// an auth scope (which credential the executor may use — never a raw secret),
// an idempotency kind (whether re-execution is safe), and a timeout budget.
// All fields are optional so existing graphs and catalog entries keep working;
// `nodeContractFor` resolves the effective contract with safe defaults.

/** Catalog schema version — bumped whenever contract semantics change. */
export const NODE_CATALOG_VERSION = 2;

/** Which credential an executor may use. `none` = pure/context-only. */
export type NodeAuthScope = "none" | "org-secret" | "user";

/**
 * Replay semantics of a node (R3):
 * - "idempotent" — re-execution is safe (pure logic, reads, notifications
 *   keyed by run+node); the engine may replay the recorded output.
 * - "at-least-once" — side effects may duplicate on retry (email, webhook,
 *   DHL booking); callers must tolerate or dedupe downstream.
 */
export type NodeIdempotencyKind = "idempotent" | "at-least-once";

/**
 * Execution semantics (AWS Durable Execution practice):
 * - "at-least-once" — the effect is retry-safe (pure, reads, keyed writes);
 *   the engine may re-execute after a crash and converges via R3 step keys.
 * - "at-most-once" — the effect must never run twice (DHL booking, one-shot
 *   sends, non-idempotent POSTs); the engine never re-executes the effect,
 *   only replays a recorded outcome, and refuses to take over an
 *   in-flight step blindly.
 */
export type NodeExecutionKind = "at-most-once" | "at-least-once";

export type NodeContract = {
  /** Contract version of this node (for graph-vs-catalog drift detection). */
  version: number;
  /** Credential scope the executor runs under. */
  auth: NodeAuthScope;
  /** Replay semantics (see NodeIdempotencyKind). */
  idempotency: NodeIdempotencyKind;
  /** Execution semantics (see NodeExecutionKind). */
  execution: NodeExecutionKind;
  /** Per-execution timeout budget in ms (engine races the executor). */
  timeoutMs: number;
};

/**
 * Default timeout budget for a node execution (a hung webhook/AI call must
 * not pin a run). Single-sourced from the scheduler so the contract and the
 * enforcement budget can never drift apart.
 */
import { DEFAULT_NODE_TIMEOUT_MS } from "@/lib/automation/scheduler";
export { DEFAULT_NODE_TIMEOUT_MS };

/** Nodes whose executors touch org-scoped secrets or external side effects. */
const ORG_SECRET_PIECES: ReadonlySet<string> = new Set([
  "action.email.send",
  "action.whatsapp.send",
  "action.http.webhook",
  "action.dhl.dispatch",
  "action.dhl.track",
  "action.dhl.label",
  "action.ai.compose",
]);

/**
 * Non-idempotent side effects: one-shot sends, real-world bookings,
 * non-idempotent POSTs. At-most-once — the engine executes the effect a
 * maximum of one time and never retries it.
 */
const AT_MOST_ONCE_PIECES: ReadonlySet<string> = new Set([
  "action.email.send",
  "action.whatsapp.send",
  "action.http.webhook",
  "action.dhl.dispatch",
]);

/** Side-effecting nodes: replay may duplicate the effect (at-least-once). */
const AT_LEAST_ONCE_PIECES: ReadonlySet<string> = new Set([
  "action.email.send",
  "action.whatsapp.send",
  "action.http.webhook",
  "action.dhl.dispatch",
  "action.notify.client",
  "action.notify.rm",
  "action.notify.role",
  "action.create.request",
  "action.case.transition",
]);

/**
 * Effective execution contract for a pieceKey. Pure + deterministic so the
 * engine can enforce timeout/auth/idempotency without a database round-trip.
 */
export function nodeContractFor(pieceKey: string): NodeContract {
  const trigger = pieceKey.startsWith("trigger.");
  return {
    version: NODE_CATALOG_VERSION,
    auth: ORG_SECRET_PIECES.has(pieceKey) ? "org-secret" : "none",
    // Triggers and pure logic/conditions are replay-safe; side effects are not.
    idempotency:
      trigger || !AT_LEAST_ONCE_PIECES.has(pieceKey)
        ? "idempotent"
        : "at-least-once",
    // Non-idempotent side effects run at-most-once; everything else keeps
    // at-least-once with R3 step keys. Triggers never execute effects.
    execution:
      !trigger && AT_MOST_ONCE_PIECES.has(pieceKey)
        ? "at-most-once"
        : "at-least-once",
    // External calls get the full budget; pure nodes fail fast.
    timeoutMs:
      ORG_SECRET_PIECES.has(pieceKey) || pieceKey.startsWith("action.")
        ? DEFAULT_NODE_TIMEOUT_MS
        : 5_000,
  };
}

export const NODE_CATALOG: NodeMeta[] = [
  // ── Triggers ──
  {
    pieceKey: "trigger.manual",
    name: "Manual start",
    category: "Trigger",
    description:
      "Starts a run when someone tests or launches the workflow by hand.",
    fields: [],
    outputs: ["triggered", "trigger"],
  },
  {
    pieceKey: "trigger.case.created",
    name: "Case created",
    category: "Trigger",
    description: "Starts when a new applicant case enters onboarding.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId"],
  },
  {
    pieceKey: "trigger.document.uploaded",
    name: "Document uploaded",
    category: "Trigger",
    description: "Starts when an applicant uploads a document (after OCR).",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "documentId"],
  },
  {
    pieceKey: "trigger.page.submitted",
    name: "Page form submitted",
    category: "Trigger",
    description:
      "Starts when a visitor submits a form on a published Lane Page.",
    fields: [],
    outputs: ["triggered", "trigger", "pageSubmissionId", "page"],
  },
  {
    pieceKey: "trigger.schedule.due",
    name: "Scheduled (follow-up due)",
    category: "Trigger",
    description: "Starts when a scheduled follow-up falls due.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId"],
  },
  {
    pieceKey: "trigger.document.approved",
    name: "Document approved",
    category: "Trigger",
    description: "Starts when a reviewer approves a client document.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "documentId", "decision"],
  },
  {
    pieceKey: "trigger.document.rejected",
    name: "Document rejected",
    category: "Trigger",
    description: "Starts when a reviewer rejects a client document.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "documentId", "decision"],
  },
  {
    pieceKey: "trigger.case.status.changed",
    name: "Case status changed",
    category: "Trigger",
    description:
      "Starts whenever the case moves to a new status (from/to land in the context).",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "from", "to"],
  },
  {
    pieceKey: "trigger.dispatch.created",
    name: "Dispatch created",
    category: "Trigger",
    description: "Starts when a DHL dispatch of the dossier is booked.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "trackingId"],
  },
  {
    pieceKey: "trigger.dispatch.tracking.updated",
    name: "Dispatch tracking updated",
    category: "Trigger",
    description:
      "Starts when DHL reports a new tracking status (in transit, delivered, exception).",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "trackingId", "status"],
  },
  {
    pieceKey: "trigger.letter.issued",
    name: "Approval letter issued",
    category: "Trigger",
    description:
      "Starts when an approval-in-principle letter is issued on the case.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "letterId"],
  },
  {
    pieceKey: "trigger.message.received",
    name: "Case message received",
    category: "Trigger",
    description: "Starts when a secure message lands on the case thread.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "messageId"],
  },
  {
    pieceKey: "trigger.reminder.due",
    name: "Reminder due",
    category: "Trigger",
    description: "Starts when a scheduled reminder falls due (deadline chase).",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "reminderId"],
  },
  {
    pieceKey: "trigger.document.expiring",
    name: "Document expiring",
    category: "Trigger",
    description: "Starts when an applicant document approaches expiry.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "documentId"],
  },
  {
    pieceKey: "trigger.case.stale",
    name: "Case gone stale",
    category: "Trigger",
    description: "Starts when a case idles past the stale threshold.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId"],
  },
  {
    pieceKey: "trigger.case.assigned",
    name: "Case assigned",
    category: "Trigger",
    description: "Starts when a case is assigned to a team member.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "assigneeId"],
  },
  {
    pieceKey: "trigger.case.data.approved",
    name: "Case data approved",
    category: "Trigger",
    description: "Starts when applicant data passes review.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "decision"],
  },
  {
    pieceKey: "trigger.case.data.rejected",
    name: "Case data rejected",
    category: "Trigger",
    description: "Starts when applicant data is sent back for correction.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "decision"],
  },
  {
    pieceKey: "trigger.case.service.selected",
    name: "Service selected",
    category: "Trigger",
    description: "Starts when a service is selected for the case.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "service"],
  },
  {
    pieceKey: "trigger.case.service.approved",
    name: "Service approved",
    category: "Trigger",
    description: "Starts when the selected service is approved.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "decision"],
  },
  {
    pieceKey: "trigger.case.service.rejected",
    name: "Service rejected",
    category: "Trigger",
    description: "Starts when the selected service is rejected.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "decision"],
  },
  {
    pieceKey: "trigger.document.confirmed",
    name: "Document confirmed",
    category: "Trigger",
    description: "Starts when a client confirms an uploaded document.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "documentId"],
  },
  {
    pieceKey: "trigger.document.changes_requested",
    name: "Document changes requested",
    category: "Trigger",
    description: "Starts when a reviewer requests changes on a document.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "documentId"],
  },
  {
    pieceKey: "trigger.request.created",
    name: "Request created",
    category: "Trigger",
    description: "Starts when a document request is raised.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "requestId"],
  },
  {
    pieceKey: "trigger.reminder.created",
    name: "Reminder created",
    category: "Trigger",
    description: "Starts when a reminder is scheduled.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "reminderId"],
  },
  {
    pieceKey: "trigger.reminder.escalated",
    name: "Reminder escalated",
    category: "Trigger",
    description: "Starts when an overdue reminder escalates.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "reminderId"],
  },
  {
    pieceKey: "trigger.booking.created",
    name: "Booking created",
    category: "Trigger",
    description: "Starts when a consultation booking is created.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "bookingId"],
  },
  {
    pieceKey: "trigger.booking.confirmed",
    name: "Booking confirmed",
    category: "Trigger",
    description: "Starts when a consultation booking is confirmed.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "bookingId"],
  },
  {
    pieceKey: "trigger.booking.cancelled",
    name: "Booking cancelled",
    category: "Trigger",
    description: "Starts when a consultation booking is cancelled.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId", "bookingId"],
  },
  {
    pieceKey: "trigger.triage.changed",
    name: "Triage changed",
    category: "Trigger",
    description: "Starts when a case triage decision changes.",
    fields: [],
    outputs: ["triggered", "trigger", "caseId"],
  },

  // ── Logic ──
  {
    pieceKey: "condition.field.equals",
    name: "If field equals",
    category: "Logic",
    description: "Branch the run: follow the 'true' or 'false' labelled edge.",
    fields: [
      {
        key: "left",
        label: "Context field",
        type: "text",
        placeholder: "e.g. documentsComplete",
        help: "Name of the run-context field to compare.",
        required: true,
      },
      {
        key: "value",
        label: "Equals value",
        type: "text",
        placeholder: "e.g. false",
      },
    ],
    outputs: ["matched"],
  },
  {
    pieceKey: "condition.field.exists",
    name: "If field exists",
    category: "Logic",
    description: "Branch when a run-context field is present and non-empty.",
    fields: [
      {
        key: "left",
        label: "Context field",
        type: "text",
        placeholder: "e.g. email",
        required: true,
      },
    ],
    outputs: ["matched"],
  },
  {
    pieceKey: "delay.duration",
    name: "Schedule follow-up",
    category: "Logic",
    description:
      "Schedule the next step after a delay — books an authority follow-up on the case when one is in context.",
    fields: [
      {
        key: "amount",
        label: "After (amount)",
        type: "number",
        placeholder: "6",
        required: true,
      },
      {
        key: "unit",
        label: "Unit",
        type: "select",
        options: ["MINUTES", "HOURS", "DAYS", "WEEKS"],
        help: "WEEKS is typical for authority follow-ups.",
      },
      {
        key: "note",
        label: "Follow-up note",
        type: "text",
        placeholder: "Follow up with the authority",
      },
    ],
    outputs: ["scheduledFor"],
  },
  {
    pieceKey: "delay.authority_followup",
    name: "Authority follow-up (weeks)",
    category: "Logic",
    description:
      "Legacy node: schedules a follow-up with the authority after N weeks.",
    fields: [
      {
        key: "weeks",
        label: "Follow-up after (weeks)",
        type: "number",
        placeholder: "6",
      },
    ],
    outputs: ["scheduledFor"],
  },
  {
    pieceKey: "wait.workflow",
    name: "Wait for workflow",
    category: "Logic",
    description:
      "Pause this run until another workflow run completes. Useful for chaining workflows (e.g. wait for onboarding before dispatch).",
    fields: [
      {
        key: "workflowId",
        label: "Workflow ID",
        type: "text",
        placeholder: "wf_abc123",
        required: true,
        help: "The ID of the workflow to wait for.",
      },
      {
        key: "runId",
        label: "Specific run ID (optional)",
        type: "text",
        placeholder: "run_xyz789",
        help: "Wait for a specific run. If empty, waits for any run of this workflow to complete.",
      },
    ],
    outputs: ["waitedFor", "completedRunId"],
  },

  // ── Communication ──
  {
    pieceKey: "action.notify.client",
    name: "Notify applicant",
    category: "Communication",
    description:
      "In-app (+ configured channels) notification to the applicant on the case.",
    fields: [
      {
        key: "title",
        label: "Title",
        type: "text",
        placeholder: "Case update",
        required: true,
      },
      {
        key: "body",
        label: "Message",
        type: "textarea",
        placeholder: "Your case has an update.",
      },
    ],
    outputs: ["notified"],
  },
  {
    pieceKey: "action.notify.rm",
    name: "Notify relationship managers",
    category: "Communication",
    description: "Notification to every assigned + staff relationship manager.",
    fields: [
      {
        key: "title",
        label: "Title",
        type: "text",
        placeholder: "Case action needed",
        required: true,
      },
      {
        key: "body",
        label: "Message",
        type: "textarea",
        placeholder: "A case requires attention.",
      },
    ],
    outputs: ["notified", "recipients"],
  },
  {
    pieceKey: "action.notify.role",
    name: "Notify role",
    category: "Communication",
    description: "Notification to every active user holding a chosen role.",
    fields: [
      {
        key: "role",
        label: "Role",
        type: "select",
        options: ["RM", "SENIOR_RM", "ADMIN", "AUDITOR"],
        required: true,
      },
      { key: "title", label: "Title", type: "text", required: true },
      { key: "body", label: "Message", type: "textarea" },
    ],
    outputs: ["notified", "recipients"],
  },
  {
    pieceKey: "action.email.send",
    name: "Send email",
    category: "Communication",
    description:
      "Email via the configured SMTP connection. Recipients: an address, 'client', or 'rm_team'.",
    fields: [
      {
        key: "to",
        label: "Recipient",
        type: "text",
        placeholder: "client | rm_team | name@example.com",
        required: true,
        help: "'client' resolves from the case; 'rm_team' emails all RMs.",
      },
      {
        key: "subject",
        label: "Subject",
        type: "text",
        placeholder: "Your Citizen Lane application",
        required: true,
      },
      {
        key: "body",
        label: "Body",
        type: "textarea",
        placeholder: "Dear client, …",
      },
    ],
    outputs: ["emailDelivered", "emailChannel", "emailDetail"],
  },
  {
    pieceKey: "action.whatsapp.send",
    name: "Send WhatsApp",
    category: "Communication",
    description:
      "WhatsApp message via the configured provider (Cloud API or gateway webhook).",
    fields: [
      {
        key: "to",
        label: "Recipient",
        type: "text",
        placeholder: "client | +41790000000",
        required: true,
        help: "'client' resolves the applicant's phone from the case.",
      },
      {
        key: "message",
        label: "Message",
        type: "textarea",
        placeholder: "Good news — your approval letter is ready.",
        required: true,
      },
    ],
    outputs: ["whatsappDelivered", "whatsappChannel", "whatsappDetail"],
  },
  {
    pieceKey: "action.http.webhook",
    name: "Call webhook",
    category: "Communication",
    description:
      "POST/GET any URL — connect the run to Slack, a relay, anything reachable.",
    fields: [
      {
        key: "url",
        label: "URL",
        type: "text",
        placeholder: "https://…",
        required: true,
      },
      {
        key: "method",
        label: "Method",
        type: "select",
        options: ["POST", "GET"],
      },
      {
        key: "bodyTemplate",
        label: "Body (JSON, {{field}} interpolated)",
        type: "textarea",
        placeholder: '{"case":"{{caseId}}"}',
      },
    ],
    outputs: ["httpStatus", "httpOk", "httpPreview"],
  },

  // ── CRM ──
  {
    pieceKey: "action.case.transition",
    name: "Update case status",
    category: "CRM",
    description:
      "Move the case in context to a new status via the legal transition table — illegal moves are skipped, never forced.",
    fields: [
      {
        key: "status",
        label: "Target status",
        type: "select",
        options: [...CASE_STATES],
        required: true,
      },
      {
        key: "reason",
        label: "Reason (recorded in history + audit)",
        type: "text",
        placeholder: "Advanced by workflow",
      },
    ],
    outputs: ["transitioned", "status"],
  },
  {
    pieceKey: "action.create.request",
    name: "Create document request",
    category: "CRM",
    description:
      "Ask the applicant for a document (Certificate of Registration, National ID, Police Record…).",
    fields: [
      {
        key: "docType",
        label: "Document type",
        type: "select",
        options: [
          "PASSPORT",
          "NATIONAL_ID",
          "POLICE_RECORD",
          "CERTIFICATE_OF_REGISTRATION",
          "BANK_STATEMENT",
          "OTHER",
        ],
        required: true,
      },
      {
        key: "title",
        label: "Request title",
        type: "text",
        placeholder: "Missing document",
        required: true,
      },
      {
        key: "instructions",
        label: "Instructions to the applicant",
        type: "textarea",
        placeholder: "Please upload the requested document.",
      },
      {
        key: "dueDays",
        label: "Due in (days)",
        type: "number",
        placeholder: "7",
      },
      { key: "flexible", label: "Accept any document type", type: "boolean" },
    ],
    outputs: ["requestId"],
  },

  // ── Logistics (DHL Express) ──
  {
    pieceKey: "action.dhl.dispatch",
    name: "DHL dispatch dossier",
    category: "CRM",
    description:
      "Book a DHL Express shipment for the case dossier — creates the dispatch record, schedules the authority follow-up, and emits the dispatch event.",
    fields: [
      {
        key: "destination",
        label: "Destination",
        type: "text",
        placeholder: "City, CountryCode (e.g. Bern, CH)",
        required: true,
        help: "{{interpolated}} from run context.",
      },
      {
        key: "documentRefs",
        label: "Document refs",
        type: "text",
        placeholder: "doc-id-1,doc-id-2",
        help: "Comma-separated document ids carried as customer references.",
      },
      { key: "pieces", label: "Pieces", type: "number", placeholder: "1" },
      {
        key: "weightKg",
        label: "Weight (kg)",
        type: "number",
        placeholder: "0.5",
      },
      {
        key: "product",
        label: "Product",
        type: "select",
        options: ["P", "B", "E", "D", "V", "X"],
        help: "P = Express Worldwide (default).",
      },
      {
        key: "followUpWeeks",
        label: "Follow-up after (weeks)",
        type: "number",
        placeholder: "6",
      },
      {
        key: "followUpNote",
        label: "Follow-up note",
        type: "text",
        placeholder: "Follow up with authority after 6 weeks",
      },
    ],
    outputs: [
      "dispatched",
      "trackingId",
      "labelUrl",
      "labelPdfBase64",
      "dispatchId",
    ],
  },
  {
    pieceKey: "action.dhl.track",
    name: "DHL track shipment",
    category: "CRM",
    description:
      "Fetch tracking events for a shipment (real API when configured, sandbox progression otherwise).",
    fields: [
      {
        key: "trackingId",
        label: "Tracking ID",
        type: "text",
        placeholder: "JD0146… or {{trackingId}}",
        help: "Falls back to the trackingId in run context.",
      },
    ],
    outputs: ["tracked", "events", "latestStatus", "latestAt"],
  },
  {
    pieceKey: "action.dhl.label",
    name: "DHL fetch label",
    category: "CRM",
    description:
      "Retrieve the shipping label (URL or PDF) for a tracking number.",
    fields: [
      {
        key: "trackingId",
        label: "Tracking ID",
        type: "text",
        placeholder: "JD0146… or {{trackingId}}",
        help: "Falls back to the trackingId in run context.",
      },
    ],
    outputs: ["fetched", "labelUrl", "labelPdfBase64"],
  },

  // ── Approval ──
  {
    pieceKey: "approval.human.gate",
    name: "Human approval gate",
    category: "Approval",
    description: "Pause the run until the chosen role approves or rejects.",
    fields: [
      {
        key: "role",
        label: "Approving role",
        type: "select",
        options: ["RM", "SENIOR_RM", "ADMIN"],
        required: true,
        help: "The run pauses until this role decides.",
      },
    ],
    outputs: ["awaiting"],
  },

  // ── AI ──
  {
    pieceKey: "action.ai.compose",
    name: "AI compose text",
    category: "AI",
    description:
      "Generate copy with the built-in AI (keyless) — e.g. a personalised update for the applicant.",
    fields: [
      {
        key: "instruction",
        label: "Instruction",
        type: "textarea",
        placeholder: "Write a warm one-paragraph update about the approval.",
        required: true,
      },
      {
        key: "inputField",
        label: "Context field to feed",
        type: "text",
        placeholder: "e.g. page",
        help: "Optional run-context field passed to the AI.",
      },
      {
        key: "outputField",
        label: "Write result to",
        type: "text",
        placeholder: "aiText",
      },
    ],
    outputs: ["aiText", "aiProvider"],
  },

  // ── Compliance ──
  {
    pieceKey: "action.audit.export",
    name: "Record audit entry",
    category: "Compliance",
    description: "Write a PII-safe entry into the audit export stream.",
    fields: [
      {
        key: "note",
        label: "Note",
        type: "text",
        placeholder: "Dispatched file #123",
      },
    ],
    outputs: ["auditRows"],
  },
];

export const NODE_CATEGORIES: NodeCategory[] = [
  "Trigger",
  "Logic",
  "Communication",
  "CRM",
  "Approval",
  "AI",
  "Compliance",
];

const byKey = new Map(NODE_CATALOG.map((n) => [n.pieceKey, n]));

export function nodeMetaByKey(pieceKey: string): NodeMeta | undefined {
  return byKey.get(pieceKey);
}

export function nodeCatalog(): NodeMeta[] {
  return NODE_CATALOG;
}
