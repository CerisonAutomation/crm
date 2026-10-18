/**
 * Platform settings registry — ONE client-safe description of every editable
 * platform section, its fields and its canon defaults.
 *
 * This module is deliberately client-safe (types + data + pure helpers only,
 * no server imports): the generic admin console, the client settings store and
 * the server store all read the very same registry, so a new field is declared
 * here once and immediately appears in the API, the manifest and the console.
 *
 * The canon defaults below reproduce the previously-hardcoded strings
 * byte-for-byte (DOC_TYPE_LABELS, the client-portal OCR FIELD_LABELS, the
 * onboarding STEP_LABELS, the RM dispatch/follow-up options, the case/document
 * status label maps from src/lib/domain/states.ts and the RM letter-type
 * options), so the app and every generated PDF render identically with zero
 * configuration. A stored override (BrandSetting.extras.platform — see
 * ./store.ts) merges over this canon, absence of any key always falling back to
 * canon.
 */

import { clampPasswordMinLength } from "@/lib/password-policy";
import { SLA_DAYS_CANON } from "@/lib/domain/lifecycle";
import { can, caseStatusLabel, docStatusLabel, type Role } from "@/lib/domain/states";
import { PROCESSING_ACTIVITIES } from "@/lib/compliance/data-map";

export type FieldType = "string" | "string[]" | "number[]" | "stringMap" | "number" | "numberMap";

export type SettingsField = {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  /**
   * Upper bound: the value cap for `number`/`number[]` fields and the length cap
   * for `string`/`string[]` fields (as used by the existing descriptors).
   */
  max?: number;
  /** Inclusive lower bound for `number` fields. */
  min?: number;
  /** Optional regex SOURCE a `string` field's value must match (validated server-side). */
  pattern?: string;
};

export type SettingsSection = {
  key: "labels" | "operations" | "governance" | "rm";
  title: string;
  description: string;
  readRoles: string[]; // CLIENT|RM|SENIOR_RM|ADMIN|AUDITOR
  /**
   * Roles that may write this section. This is the SECOND half of the write
   * gate: the route ALSO requires the section's `writeCapability`. Both must
   * hold, so a role listed here without the capability (or vice-versa) is denied.
   */
  writeRoles: string[];
  /**
   * The capability required to write this section. Defaults to `settings.write`
   * (held only by ADMIN, via `*`) when omitted — so a section is ADMIN-only
   * until it is deliberately opened. The desk-owned sections (`operations`,
   * `rm`) declare `settings.desk.write`, which RM/SENIOR_RM hold but the
   * read-only roles do not; `labels` and every future section stay ADMIN-only.
   */
  writeCapability?: string;
  fields: SettingsField[];
};

/** The capability that gates writing a section (ADMIN-only unless declared). */
export function sectionWriteCapability(section: SettingsSection): string {
  return section.writeCapability ?? "settings.write";
}

/**
 * May `role` write `section`? True only when the role holds the section's
 * capability AND is listed in the section's `writeRoles` — the exact gate the
 * PUT / reset routes enforce, exposed here so the UI can disable controls for
 * the sections a role cannot save (rather than offering a button that 403s).
 * Deny-by-default: an unknown role, or a section nobody opened, is false.
 */
export function canWriteSection(role: string, section: SettingsSection): boolean {
  return section.writeRoles.includes(role) && can(role as Role, sectionWriteCapability(section));
}

export type PlatformSettings = {
  labels: {
    docTypes: Record<string, string>;
    ocrFieldLabels: Record<string, string>;
    onboardingSteps: string[];
    letterTypes: Record<string, string>;
    caseStatuses: Record<string, string>;
    docStatuses: Record<string, string>;
  };
  operations: {
    dispatchDestinations: string[];
    defaultDestination: string;
    followUpWeeks: number[];
    maxUploadMb: number;
    acceptedExtensions: string[];
    passwordMinLength: number;
    /** Per-stage service-level target, in days, keyed by lifecycle stage. */
    slaDays: Record<string, number>;
  };
  /**
   * Governance & records — retention windows, audit paging and the default
   * quiet-hours window. Deliberately its OWN section, written by ADMIN alone:
   * opening it to the desk (as `operations` is) would let an advisor change
   * data-retention policy, which is not a desk decision.
   */
  governance: {
    /** Rows per page in the audit explorer (hard-capped at AUDIT_PAGE_SIZE_MAX). */
    auditPageSize: number;
    /** Window pre-filled for a user who has not set their own quiet hours ("HH:MM-HH:MM"). */
    quietHoursDefault: string;
    /** Retention window, in days, per processing activity id (drives the retention runner). */
    retentionDays: Record<string, number>;
  };
  rm: {
    reviewReasons: string[];
  };
};

/** Every authenticated role — the `labels` section is readable by all of them. */
const ALL_ROLES: string[] = ["CLIENT", "RM", "SENIOR_RM", "ADMIN", "AUDITOR"];
const ADMIN_ONLY: string[] = ["ADMIN"];
/**
 * Writers of a DESK-OWNED section: the two staff-desk roles may edit the
 * settings that govern their own desk, plus ADMIN (who may always write). The
 * route pairs this with the section's `writeCapability` ("settings.desk.write"),
 * so listing a role here is necessary but not sufficient.
 */
const DESK_WRITERS: string[] = ["RM", "SENIOR_RM", "ADMIN"];

/**
 * Canon audit page size (rows per page in the audit explorer) and the HARD
 * server cap the API enforces. Rows above the cap are always truncated, so an
 * over-large configured value can never be used to widen the audit listing.
 */
export const AUDIT_PAGE_SIZE_CANON = 25;
export const AUDIT_PAGE_SIZE_MAX = 50;

/**
 * A quiet-hours window: "HH:MM-HH:MM" (24-hour, evaluated on the server clock).
 * ONE definition, shared by the preferences dialog, the settings validation and
 * the canon merge, so the three can never disagree about a valid window.
 */
export const QUIET_HOURS_PATTERN = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

/** True when `value` is a well-formed quiet-hours window. */
export function isQuietHoursWindow(value: unknown): value is string {
  return typeof value === "string" && QUIET_HOURS_PATTERN.test(value);
}

/**
 * Canon retention windows (days), keyed by processing-activity id, DERIVED from
 * the governance register (src/lib/compliance/data-map.ts) so a stored default
 * cannot drift from the published RoPA. Activities kept for the life of the
 * engagement carry no window and are therefore absent.
 */
export const RETENTION_DAYS_CANON: Record<string, number> = Object.fromEntries(
  PROCESSING_ACTIVITIES.filter((a) => a.retention.days !== null).map((a) => [a.id, a.retention.days as number]),
);

/** Canon — today's exact strings; the fallback for every consumer. */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  labels: {
    docTypes: {
      PASSPORT: "Passport",
      NATIONAL_ID: "National ID",
      POLICE_RECORD: "Police Record",
      CERTIFICATE_OF_REGISTRATION: "Certificate of Registration",
      BANK_STATEMENT: "Bank Statement",
      OTHER: "Other Document",
    },
    ocrFieldLabels: {
      fullName: "Full name",
      documentNumber: "Document number",
      nationality: "Nationality",
      dateOfBirth: "Date of birth",
      dateOfExpiry: "Date of expiry",
      issuingCountry: "Issuing country",
    },
    onboardingSteps: ["Profile", "Passport", "Verify", "Programme"],
    letterTypes: {
      APPROVAL_IN_PRINCIPLE: "Approval in Principle",
      FINAL_APPROVAL: "Final Approval",
      DOCUMENT_REQUEST: "Document Request",
      ENGAGEMENT_FEE_PROPOSAL: "Engagement & Fee Proposal",
      PAYMENT_RECEIPT: "Payment Receipt",
    },
    // Byte-identical copy of `caseStatusLabel`'s map (src/lib/domain/states.ts).
    caseStatuses: {
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
      COMPLETED: "Completed",
      CANCELLED: "Cancelled",
    },
    // Byte-identical copy of `docStatusLabel`'s map (src/lib/domain/states.ts).
    docStatuses: {
      UPLOADED: "Uploaded",
      OCR_PROCESSING: "Reading (OCR)",
      OCR_PROCESSED: "Awaiting your confirmation",
      CLIENT_CONFIRMED: "Confirmed by client",
      IN_REVIEW: "Under RM review",
      RM_APPROVED: "Approved",
      RM_REJECTED: "Rejected",
      CHANGES_REQUESTED: "Changes requested",
    },
  },
  operations: {
    dispatchDestinations: [],
    defaultDestination: "",
    followUpWeeks: [4, 6, 8],
    maxUploadMb: 10,
    acceptedExtensions: ["pdf", "jpg", "jpeg", "png", "bmp"],
    passwordMinLength: 10,
    // Derived from the stage table so the default cannot drift from the domain.
    slaDays: SLA_DAYS_CANON,
  },
  governance: {
    // Today's frozen literals — the fallback until an admin edits them.
    auditPageSize: AUDIT_PAGE_SIZE_CANON,
    quietHoursDefault: "22:00-07:00",
    // Derived from the governance register so the window cannot drift from the RoPA.
    retentionDays: RETENTION_DAYS_CANON,
  },
  rm: {
    reviewReasons: [
      "Documents complete and legible",
      "Matches the application data",
      "Signature verified against specimen",
      "Requesting a clearer scan",
      "Document expired — renewal required",
    ],
  },
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "labels",
    title: "Labels & copy",
    description:
      "Document type labels, OCR field labels, letter names, status labels and the onboarding step names shown across the app, the client portal and generated letters.",
    readRoles: ALL_ROLES,
    writeRoles: ADMIN_ONLY,
    fields: [
      { key: "docTypes", type: "stringMap", label: "Document type labels", help: "Shown wherever a document type is listed.", max: 120 },
      { key: "ocrFieldLabels", type: "stringMap", label: "OCR field labels", help: "Shown for each extracted document field.", max: 120 },
      { key: "onboardingSteps", type: "string[]", label: "Onboarding steps", help: "The four steps of the client onboarding wizard.", max: 120 },
      { key: "letterTypes", type: "stringMap", label: "Letter type labels", help: "Shown when issuing and listing official letters.", max: 120 },
      { key: "caseStatuses", type: "stringMap", label: "Case status labels", help: "Shown wherever a case stage is displayed.", max: 120 },
      { key: "docStatuses", type: "stringMap", label: "Document status labels", help: "Shown wherever a document's state is displayed.", max: 120 },
    ],
  },
  {
    key: "operations",
    title: "Operations",
    description:
      "Dispatch destinations, the default destination, follow-up intervals and the document upload policy used by the RM desk and the client portal.",
    readRoles: ["RM", "SENIOR_RM", "ADMIN", "AUDITOR"],
    writeRoles: DESK_WRITERS,
    writeCapability: "settings.desk.write",
    fields: [
      { key: "dispatchDestinations", type: "string[]", label: "Dispatch destinations", help: "Suggested destinations for the DHL dispatch field (the field stays free text). Format: Authority name, City[, Street, Postal City, CC] — a trailing 2-letter country code sets the DHL destination country (default CH).", max: 120 },
      { key: "defaultDestination", type: "string", label: "Default destination", help: "Pre-filled when the dispatch dialog opens.", max: 120 },
      { key: "followUpWeeks", type: "number[]", label: "Follow-up intervals (weeks)", help: "Whole weeks between 1 and 52.", max: 52 },
      { key: "maxUploadMb", type: "number", label: "Maximum upload size (MB)", help: "Enforced server-side; whole megabytes between 1 and 50.", min: 1, max: 50 },
      { key: "acceptedExtensions", type: "string[]", label: "Accepted file extensions", help: "Lower-case extensions without the dot (pdf, jpg, png…). Content is still verified by magic-byte sniffing.", max: 10 },
      { key: "passwordMinLength", type: "number", label: "Minimum password length", help: "Enforced on sign-up, password reset and change. Whole characters between 8 and 64; the sign-in screens show the same number.", min: 8, max: 64 },
      { key: "slaDays", type: "numberMap", label: "Stage service levels (days)", help: "Target days allowed in each case stage. Drives the SLA column and overdue flags in the case queue and the funnel report. Whole days between 1 and 365.", min: 1, max: 365 },
    ],
  },
  {
    key: "governance",
    title: "Governance & records",
    description:
      "Retention windows enforced by the records runner, the audit explorer's page size and the default quiet-hours window. Written by ADMIN alone — retention is not a desk decision.",
    // Staff who may already read the RoPA / the audit explorer. Never CLIENT:
    // the governance register is staff-only, and this section must not widen it.
    readRoles: ["RM", "SENIOR_RM", "ADMIN", "AUDITOR"],
    writeRoles: ADMIN_ONLY,
    fields: [
      { key: "auditPageSize", type: "number", label: "Audit page size (rows)", help: `Rows per page in the audit explorer. Always capped at ${AUDIT_PAGE_SIZE_MAX} server-side.`, min: 1, max: AUDIT_PAGE_SIZE_MAX },
      { key: "quietHoursDefault", type: "string", label: "Default quiet hours", help: "The window pre-filled for a user who has not set their own, as 24-hour HH:MM-HH:MM. Held on the server clock; approval and dispatch events are never suppressed.", max: 120, pattern: QUIET_HOURS_PATTERN.source },
      { key: "retentionDays", type: "numberMap", label: "Retention windows (days)", help: "Days each processing activity's records are kept. Drives the retention runner's purge cutoffs and the published governance model. Whole days between 1 and 36500.", min: 1, max: 36500 },
    ],
  },
  {
    key: "rm",
    title: "Relationship management",
    description:
      "The quick-pick review reasons offered to relationship managers when approving or rejecting a document — filling the textarea, never changing what is submitted.",
    readRoles: ["RM", "SENIOR_RM", "ADMIN", "AUDITOR"],
    writeRoles: DESK_WRITERS,
    writeCapability: "settings.desk.write",
    fields: [
      { key: "reviewReasons", type: "string[]", label: "Review reasons", help: "Short, reusable explanations offered as chips in the review dialogs.", max: 160 },
    ],
  },
];

/** Find a section by its registry key (undefined when unknown). */
export function findSettingsSection(key: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.key === key);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strOr(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

function strArrOr(raw: unknown, fallback: string[]): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [...fallback];
}

function numArrOr(raw: unknown, fallback: number[]): number[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is number => typeof v === "number" && Number.isInteger(v))
    : [...fallback];
}

function numOr(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** Keep an audit page size inside [1, AUDIT_PAGE_SIZE_MAX], the server's own cap. */
function clampAuditPageSize(n: number): number {
  return Math.min(AUDIT_PAGE_SIZE_MAX, Math.max(1, Math.round(n)));
}

/**
 * Merge a stored keyed map of integers over canon. Keys are restricted to the
 * canon keys, matching the `stringMap` rule, so an operator cannot invent a
 * stage that the domain would never evaluate.
 */
function numberMapOr(raw: unknown, fallback: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...fallback };
  if (isPlainObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in fallback)) continue;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && Number.isInteger(n)) out[k] = n;
    }
  }
  return out;
}

function strMapOr(raw: unknown, fallback: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...fallback };
  if (isPlainObject(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Merge a stored (possibly partial, possibly malformed) platform value over the
 * canon defaults, section by section and field by field. Every returned value is
 * a fresh object, so callers can never mutate the shared canon. Pure and
 * client-safe — used by both the server store and the client module store.
 */
export function mergePlatformSettings(stored: unknown): PlatformSettings {
  const src = isPlainObject(stored) ? stored : {};
  const labels = isPlainObject(src.labels) ? src.labels : {};
  const operations = isPlainObject(src.operations) ? src.operations : {};
  const governance = isPlainObject(src.governance) ? src.governance : {};
  const rm = isPlainObject(src.rm) ? src.rm : {};
  return {
    labels: {
      docTypes: strMapOr(labels.docTypes, DEFAULT_PLATFORM_SETTINGS.labels.docTypes),
      ocrFieldLabels: strMapOr(labels.ocrFieldLabels, DEFAULT_PLATFORM_SETTINGS.labels.ocrFieldLabels),
      onboardingSteps: strArrOr(labels.onboardingSteps, DEFAULT_PLATFORM_SETTINGS.labels.onboardingSteps),
      letterTypes: strMapOr(labels.letterTypes, DEFAULT_PLATFORM_SETTINGS.labels.letterTypes),
      caseStatuses: strMapOr(labels.caseStatuses, DEFAULT_PLATFORM_SETTINGS.labels.caseStatuses),
      docStatuses: strMapOr(labels.docStatuses, DEFAULT_PLATFORM_SETTINGS.labels.docStatuses),
    },
    operations: {
      dispatchDestinations: strArrOr(operations.dispatchDestinations, DEFAULT_PLATFORM_SETTINGS.operations.dispatchDestinations),
      defaultDestination: strOr(operations.defaultDestination, DEFAULT_PLATFORM_SETTINGS.operations.defaultDestination),
      followUpWeeks: numArrOr(operations.followUpWeeks, DEFAULT_PLATFORM_SETTINGS.operations.followUpWeeks),
      maxUploadMb: numOr(operations.maxUploadMb, DEFAULT_PLATFORM_SETTINGS.operations.maxUploadMb),
      acceptedExtensions: strArrOr(operations.acceptedExtensions, DEFAULT_PLATFORM_SETTINGS.operations.acceptedExtensions),
      passwordMinLength: clampPasswordMinLength(numOr(operations.passwordMinLength, DEFAULT_PLATFORM_SETTINGS.operations.passwordMinLength)),
      slaDays: numberMapOr(operations.slaDays, DEFAULT_PLATFORM_SETTINGS.operations.slaDays),
    },
    governance: {
      auditPageSize: clampAuditPageSize(numOr(governance.auditPageSize, DEFAULT_PLATFORM_SETTINGS.governance.auditPageSize)),
      quietHoursDefault: isQuietHoursWindow(governance.quietHoursDefault)
        ? governance.quietHoursDefault
        : DEFAULT_PLATFORM_SETTINGS.governance.quietHoursDefault,
      retentionDays: numberMapOr(governance.retentionDays, DEFAULT_PLATFORM_SETTINGS.governance.retentionDays),
    },
    rm: {
      reviewReasons: strArrOr(rm.reviewReasons, DEFAULT_PLATFORM_SETTINGS.rm.reviewReasons),
    },
  };
}

// ── Settings-first label resolution ─────────────────────────────────────────
//
// The status label maps are admin-editable (labels.caseStatuses / labels.
// docStatuses). Consumers MUST read the platform map first and fall back to the
// domain canon — the exact rule src/lib/services/event-hub.ts applies — so a
// rename shows everywhere: the RM queue, the admin console, the AI context, the
// CSV exports and the document action responses. ONE rule, not one per surface.

/** Resolve a case-status label settings-first, falling back to the domain canon. */
export function platformCaseStatusLabel(settings: PlatformSettings, status: string): string {
  return settings.labels.caseStatuses[status] ?? caseStatusLabel(status);
}

/** Resolve a document-status label settings-first, falling back to the domain canon. */
export function platformDocStatusLabel(settings: PlatformSettings, status: string): string {
  return settings.labels.docStatuses[status] ?? docStatusLabel(status);
}
