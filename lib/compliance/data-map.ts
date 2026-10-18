/**
 * Governance as code — the platform's Record of Processing Activities (RoPA),
 * data classification and retention policy, expressed as data so it can be
 * published, diffed and audited rather than living in a PDF nobody reads.
 *
 * Standards this file encodes:
 *  - EU GDPR Art. 5(1)(e) storage limitation, Art. 6 lawful basis, Art. 30
 *    records of processing, Art. 32 security of processing.
 *  - Swiss FADP / nDSG (SR 235.1) — proportionate necessity, plus the 10-year
 *    business-record retention of OR Art. 958f / Art. 962 that outlives an
 *    erasure request (GDPR Art. 17(3)(b)).
 *  - AML/KYC retention for financial intermediaries (SRO supervision; AMLA).
 *  - ISO 15489 records management: retention rules only mean something with an
 *    authorised disposition process AND an audit trail of destruction — hence
 *    `legalHold` below and the `retention.purged` audit event in retention.ts.
 *
 * Design rule: **statutory records and operational exhaust are separate
 * activities.** They have different lawful bases, different retention windows
 * and different disposal paths; conflating them is how a production system
 * either deletes evidence or hoards noise forever.
 *
 * Pure data — no server imports, so both the API and any client can read it.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** How sensitive the data is, used to gate access and redaction strength. */
export type DataClass = "PUBLIC" | "INTERNAL" | "PII" | "SENSITIVE";

/** GDPR Art. 6(1) lawful bases used by this platform. */
export type LawfulBasis =
  | "CONTRACT"
  | "LEGAL_OBLIGATION"
  | "CONSENT"
  | "LEGITIMATE_INTERESTS";

export type RetentionRule = {
  /** Days kept after the record's live life ends; `null` = for as long as the account/engagement runs. */
  days: number | null;
  /** The legal or operational source of the retention period. */
  basis: string;
  /**
   * Statutory / evidentiary retention: the record must NOT be auto-deleted by
   * the housekeeping runner — disposal requires an authorised process
   * (ISO 15489 disposition).
   */
  legalHold: boolean;
};

export type ProcessingActivity = {
  id: string;
  name: string;
  purpose: string;
  lawfulBasis: LawfulBasis;
  dataClass: DataClass;
  /** Prisma models that hold this activity's data. */
  models: string[];
  dataSubjects: string;
  retention: RetentionRule;
  /** Who receives the data (processors, authorities). */
  recipients: string[];
  internationalTransfers: string;
  /** How data-subject rights are honoured for this activity. */
  rightsNotes: string;
  /** Technical and organisational measures (GDPR Art. 32). */
  securityControls: string[];
};

// ── The register ────────────────────────────────────────────────────────────

/** Shared transfer note for every DB-backed activity. */
export const DB_TRANSFER =
  "Case data at rest in the USA (Neon, AWS us-east-1) under EU Standard " +
  "Contractual Clauses (GDPR Art. 46(2)(c)) with a transfer-impact assessment.";

export const PROCESSING_ACTIVITIES: ProcessingActivity[] = [
  {
    id: "client-onboarding",
    name: "Application intake & case management",
    purpose:
      "Assess, prepare and execute citizenship and residence applications on behalf of the client.",
    lawfulBasis: "CONTRACT",
    dataClass: "PII",
    models: [
      "User",
      "Case",
      "CaseAssignment",
      "CaseStatusHistory",
      "DocumentRequest",
      "ExtractedField",
      "Comment",
      "Reminder",
      "RenewalReminder",
      "FollowUp",
    ],
    dataSubjects: "Applicants and their family members",
    retention: {
      days: 3650,
      basis: "Business records — OR Art. 962 / Art. 958f (10 years), plus nDSG",
      legalHold: true,
    },
    recipients: [
      "Competent authorities (on dispatch)",
      "Relationship management desk",
    ],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Access and rectification through the client portal; erasure is declined while a statutory retention duty applies (GDPR Art. 17(3)(b)).",
    securityControls: [
      "Deny-by-default capability matrix (RBAC)",
      "Per-case scoping for relationship managers",
      "Append-only audit trail on every transition",
    ],
  },
  {
    id: "identity-documents",
    name: "KYC identity documents & case dossier",
    purpose:
      "Verify identity and eligibility, and satisfy AML/KYC and authority filing requirements.",
    lawfulBasis: "LEGAL_OBLIGATION",
    dataClass: "SENSITIVE",
    models: [
      "Document",
      "OcrJob",
      "DocumentReview",
      "ApprovalLetter",
      "Dispatch",
    ],
    dataSubjects: "Applicants",
    retention: {
      days: 3650,
      basis: "AML/KYC retention (SRO supervision) and OR Art. 962",
      legalHold: true,
    },
    recipients: [
      "Configured OCR sub-processor",
      "Courier (DHL)",
      "Competent authorities",
    ],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Erasure restricted while the statutory retention duty applies; a copy is available on request.",
    securityControls: [
      "Magic-byte content sniffing (never trusting the declared MIME type)",
      "Malware scan status recorded per document",
      "Opaque vault keys — no caller builds a filesystem path",
      "Redacted field previews in logs and audit snapshots",
    ],
  },
  {
    id: "communications",
    name: "Client communications & consultations",
    purpose:
      "Answer enquiries, book consultations and notify clients about case progress.",
    lawfulBasis: "CONTRACT",
    dataClass: "PII",
    models: ["Notification", "Booking", "Consultation", "MessageTemplate"],
    dataSubjects: "Applicants and enquirers",
    retention: {
      days: 2555,
      basis: "Business correspondence — 7 years",
      legalHold: false,
    },
    recipients: ["Admin-configured email / WhatsApp / push providers"],
    internationalTransfers: "Depends on the region of the configured provider",
    rightsNotes: "Per-channel preferences and quiet hours are user-controlled.",
    securityControls: [
      "Channel preferences and quiet hours respected at delivery",
      "Provider credentials held in admin-managed integration settings, never in code",
    ],
  },
  {
    id: "client-preferences",
    name: "Notification preferences",
    purpose: "Honour each user's per-channel delivery choices and quiet hours.",
    lawfulBasis: "CONTRACT",
    dataClass: "PII",
    models: ["NotificationPreference"],
    dataSubjects: "Users of the platform",
    retention: {
      days: null,
      basis: "Kept while the account exists; deleted with it",
      legalHold: false,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes: "Editable by the user at any time; never purged on a timer.",
    securityControls: ["One row per user, org-scoped reads"],
  },
  {
    id: "consent-receipts",
    name: "Consent receipts (accountability proof)",
    purpose:
      "Prove what was consented to, when, and in which policy version (GDPR Art. 7(1)).",
    lawfulBasis: "CONSENT",
    dataClass: "PII",
    models: ["Consent"],
    dataSubjects: "Website visitors and users",
    retention: {
      days: 2190,
      basis: "Consent proof — GDPR Art. 7(1) accountability (6 years)",
      legalHold: true,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes: "Withdrawal updates the receipt; rows are never auto-purged.",
    securityControls: [
      "Explicit consent record with timestamp and policy version",
    ],
  },
  {
    id: "marketing-leads",
    name: "Website enquiries, leads & consent records",
    purpose:
      "Respond to enquiries and send the newsletter only where consent was given.",
    lawfulBasis: "CONSENT",
    dataClass: "PII",
    models: ["Lead", "PageSubmission"],
    dataSubjects: "Website visitors and enquirers",
    retention: {
      days: 730,
      basis: "Consent lifespan + 24 months",
      legalHold: false,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes: "Consent can be withdrawn at any time; erasure on request.",
    securityControls: [
      "Explicit consent record with timestamp",
      "Public form submissions correlated to a workflow run for traceability",
    ],
  },
  {
    id: "account-security",
    name: "Accounts, sessions & devices",
    purpose:
      "Authenticate users, protect accounts and deliver push notifications.",
    lawfulBasis: "LEGITIMATE_INTERESTS",
    dataClass: "PII",
    models: ["Session", "AuthToken", "PushSubscription", "Connection"],
    dataSubjects: "Users of the platform",
    retention: {
      days: 90,
      basis: "Security housekeeping — 90 days after expiry",
      legalHold: false,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Sessions are revocable by the user or an administrator at any time.",
    securityControls: [
      "Passwords hashed; one-time tokens stored only as hashes",
      "Session revocation and CSRF protection",
      "Request rate limiting",
    ],
  },
  {
    id: "billing",
    name: "Invoicing & payments",
    purpose: "Issue invoices and record payments for the engagement.",
    lawfulBasis: "LEGAL_OBLIGATION",
    dataClass: "PII",
    models: ["Invoice", "Payment"],
    dataSubjects: "Clients",
    retention: {
      days: 3650,
      basis: "Accounting retention — OR Art. 958f / VAT (10 years)",
      legalHold: true,
    },
    recipients: ["Banking / payment providers"],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Erasure is restricted during the accounting retention period.",
    securityControls: [
      "Organisation-scoped queries",
      "Append-only audit trail",
    ],
  },
  {
    id: "audit-accountability",
    name: "Audit trail (accountability record)",
    purpose:
      "Demonstrate accountability for every consequential action and support incident response.",
    lawfulBasis: "LEGAL_OBLIGATION",
    dataClass: "INTERNAL",
    models: ["AuditEvent"],
    dataSubjects:
      "Users (actor identifiers) and clients (referenced case references)",
    retention: {
      days: 3650,
      basis:
        "Accountability and records — the audit trail is kept with the case file",
      legalHold: true,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Actor identifiers are retained where required for accountability; snapshots are redacted before storage.",
    securityControls: [
      "Append-only audit trail",
      "Before/after snapshots redacted before storage",
      "Correlation ids on every request",
    ],
  },
  {
    id: "operational-telemetry",
    name: "Product telemetry",
    purpose: "Measure product usage and errors to keep the platform operable.",
    lawfulBasis: "LEGITIMATE_INTERESTS",
    dataClass: "INTERNAL",
    models: ["TelemetryEvent"],
    dataSubjects: "Users (pseudonymous session ids)",
    retention: {
      days: 14,
      basis: "Short operational window — enforced by pruneTelemetry",
      legalHold: false,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Pseudonymous; no free-text personal data by contract (capped and redacted).",
    securityControls: [
      "Props redacted and capped at 2KB",
      "Rolling 14-day window",
    ],
  },
  {
    id: "operational-delivery",
    name: "Delivery ledger & idempotency keys",
    purpose:
      "Replay undelivered events and guarantee exactly-once handling of retried requests.",
    lawfulBasis: "LEGITIMATE_INTERESTS",
    dataClass: "INTERNAL",
    models: ["OutboxEvent", "WebhookDelivery", "IdempotencyKey"],
    dataSubjects: "None directly (payloads may reference a case)",
    retention: {
      days: 30,
      basis: "Operational replay / retry window",
      legalHold: false,
    },
    recipients: ["Admin-configured outbound webhook endpoints"],
    internationalTransfers: "Depends on the configured webhook destination",
    rightsNotes: "Operational records; erased on the rolling window.",
    securityControls: [
      "HMAC-SHA256 signed webhook payloads",
      "Retry backoff with a bounded attempt count",
    ],
  },
  {
    id: "realtime-calling-exhaust",
    name: "P2P calling & meeting signaling exhaust",
    purpose:
      "Relay WebRTC SDP/ICE handshake rows for 1:1 case calls and team meetings, then dispose of them " +
      "on a short window after the call/meeting ends. Media itself never touches the server (1:1 audio is " +
      "never stored); only the handshake rows plus the explicitly-consented live transcript and the host's " +
      "vault recording reach the database/vault, and those are scrubbed on the same post-END window.",
    lawfulBasis: "LEGITIMATE_INTERESTS",
    dataClass: "INTERNAL",
    models: ["CallSignal", "MeetingSignal", "CallSession", "Meeting"],
    dataSubjects:
      "Users (signaling rows carry no media, only handshake bytes and consent proofs)",
    retention: {
      days: 30,
      basis:
        "Trust window — 30 days after the call/meeting ends (post-END): signals are deleted, " +
        "transcripts are nulled and vault recordings destroyed",
      legalHold: false,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes:
      "Operational exhaust; the 30-day window runs from the parent's endedAt, so live and recently-ended calls are never touched.",
    securityControls: [
      "SDP/ICE values never logged — only opaque rows are persisted",
      "Post-END cutoff derived from the parent call/meeting, not the signal timestamp",
      "Call/meeting rows are scrubbed (transcript nulled, vault bytes destroyed), never deleted",
    ],
  },
  {
    id: "platform-config",
    name: "Platform, workflow & brand configuration",
    purpose:
      "Operate the platform itself: workflows, lane pages, integrations, brand and business settings.",
    lawfulBasis: "LEGITIMATE_INTERESTS",
    dataClass: "INTERNAL",
    models: [
      "Programme",
      "Workflow",
      "WorkflowVersion",
      "WorkflowRun",
      "WorkflowNodeRun",
      "LanePage",
      "AutomationRule",
      "PieceDefinition",
      "FeatureFlag",
      "IntegrationSetting",
      "WebhookEndpoint",
      "MessageTemplate",
      "BrandSetting",
      "Organisation",
    ],
    dataSubjects: "Staff (operator identifiers in updatedBy fields)",
    retention: {
      days: null,
      basis: "Kept for the lifetime of the engagement",
      legalHold: false,
    },
    recipients: [],
    internationalTransfers: DB_TRANSFER,
    rightsNotes: "Holds no client personal data beyond operator identifiers.",
    securityControls: [
      "Administrator-only writes, audited with before/after snapshots",
      "Integration secrets masked on read and never returned",
    ],
  },
];

// ── Derived lookups ─────────────────────────────────────────────────────────

/** Model → the activity that governs it. */
export function activityForModel(model: string): ProcessingActivity | null {
  return PROCESSING_ACTIVITIES.find((a) => a.models.includes(model)) ?? null;
}

export function dataClassOf(model: string): DataClass | null {
  return activityForModel(model)?.dataClass ?? null;
}

export function retentionFor(model: string): RetentionRule | null {
  return activityForModel(model)?.retention ?? null;
}

/**
 * Effective retention window, in days, for one model — the canon rule's days
 * overlaid with an operator override keyed by the OWNING activity's id (see
 * settings.governance.retentionDays). A `null` canon (engagement-lifetime)
 * stays null: those records are never on a timer. An override only ever changes
 * the WINDOW; it can never move a model into or out of the purge tier, which is
 * decided by `legalHold` — deliberately not editable.
 */
export function retentionDaysFor(
  model: string,
  overrides?: Record<string, number> | null
): number | null {
  const activity = activityForModel(model);
  if (!activity) return null;
  const canon = activity.retention.days;
  if (canon === null) return null;
  const override = overrides?.[activity.id];
  return typeof override === "number" &&
    Number.isFinite(override) &&
    override > 0
    ? Math.floor(override)
    : canon;
}

/**
 * The purge tier RESOLVED against an operator override map: identical in shape
 * and membership to `PURGE_TIER`, but each entry's `days` is the effective
 * window. The retention runner consumes THIS, so a configured window changes the
 * cutoff it applies, while the default (no override) reproduces canon exactly.
 */
export function purgeTierFor(
  overrides?: Record<string, number> | null
): Array<{ model: string; days: number }> {
  return PROCESSING_ACTIVITIES.filter(
    (a) => !a.retention.legalHold && a.retention.days !== null
  ).flatMap((a) =>
    a.models.map((model) => ({
      model,
      days: retentionDaysFor(model, overrides) as number,
    }))
  );
}

/**
 * The canon purge tier — the ONLY models the automated housekeeping runner may
 * delete from: the activities whose retention is a bounded operational window
 * and which carry no legal hold. Everything else is a statutory/evidentiary
 * record (disposal needs an authorised process, never a timer) or lives for the
 * life of the account. Derived from `purgeTierFor(null)` so the published and
 * the enforced tier can never diverge.
 */
export const PURGE_TIER: Array<{ model: string; days: number }> =
  purgeTierFor(null);

/** Rows kept for as long as the account/engagement runs — never on a timer. */
export const ENGAGEMENT_LIFETIME_MODELS: string[] =
  PROCESSING_ACTIVITIES.filter((a) => a.retention.days === null).flatMap(
    (a) => a.models
  );

/** Models that must never be auto-purged, with the retention basis. */
export const LEGAL_HOLD_MODELS: Array<{ model: string; basis: string }> =
  PROCESSING_ACTIVITIES.filter((a) => a.retention.legalHold).flatMap((a) =>
    a.models.map((model) => ({ model, basis: a.retention.basis }))
  );

// ── Controller identity ─────────────────────────────────────────────────────

/**
 * The controller block for the RoPA. Deliberately generic: the legal entity is
 * the operator's own details, which live in the brand/business settings rather
 * than being baked in here.
 */
export const CONTROLLER = {
  role: "Controller",
  note: "The operating firm is the controller; contact details are configured in Brand & Business settings.",
  dpoNote:
    "A data protection adviser must be named in the settings before launch in a regulated EU/EEA market.",
} as const;
