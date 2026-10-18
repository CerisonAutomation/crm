/**
 * CRM projections — pure, Prisma-free timeline / relations / views layer.
 *
 * Why this module exists: the CRM service (src/lib/services/crm.ts) writes one
 * append-only Activity row per interaction, but reads were raw rows with no
 * actor/source/timestamp/correlationId/transition discipline, no unified merge
 * with the hash-chained CaseEvent ledger or the AuditEvent trail, no
 * relationship metadata, no per-role PII visibility, no configurable views and
 * no cross-entity search. This module is the read-side answer: every function
 * is total, dependency-free and safe to import from client components, routes
 * and unit specs alike (it never touches the database).
 *
 * Pattern references (patterns only — no code is copied from these projects):
 * - Twenty: metadata-driven entities, configurable list views, timeline
 *   streams, command-style actions, workspace-level permissions.
 * - EspoCRM: explicit entity relations, hook-style side effects, per-role
 *   field/action permissions, import/export discipline, relationship-aware
 *   history, server-side rules.
 */

export type ActivitySource =
  | "MANUAL"
  | "EMAIL"
  | "CALL"
  | "MEETING"
  | "DOCUMENT"
  | "CASE"
  | "WORKFLOW"
  | "SCREENING"
  | "IMPORT"
  | "SYSTEM";

export type ViewerRole =
  | "ADMIN"
  | "SENIOR_RM"
  | "RM"
  | "AUDITOR"
  | "CLIENT"
  | "PARTNER";

export interface StateTransition {
  from: string | null;
  to: string;
}

export interface TimelineActor {
  id: string | null;
  label: string;
  role: string | null;
}

/**
 * CaseActivity — the normalised CRM fact. Every timeline row, wherever it was
 * written (Activity table, CaseEvent ledger, audit trail), projects into this
 * shape so the feed, search and the FS-11 bundle share one contract.
 */
export interface CaseActivity {
  id: string;
  orgId: string;
  caseId: string | null;
  contactId: string | null;
  leadId: string | null;
  kind: string;
  summary: string;
  actor: TimelineActor;
  source: ActivitySource;
  /** ISO-8601 creation timestamp — the stream sort key. */
  timestamp: string;
  correlationId: string | null;
  transition: StateTransition | null;
  auditEventId: string | null;
  metadata: Record<string, unknown>;
}

/** Minimal structural input — mirrors the Activity / CaseEvent rows, no Prisma types. */
export interface RawActivityRow {
  id: string;
  orgId: string;
  kind: string;
  summary: string;
  contactId?: string | null;
  caseId?: string | null;
  leadId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  actorRole?: string | null;
  source?: string | null;
  createdAt: string | Date;
  correlationId?: string | null;
  transition?: StateTransition | null;
  auditEventId?: string | null;
  metadata?: string | Record<string, unknown> | null;
}

export interface RawCaseEventRow {
  id: string;
  topic: string;
  payload?: string | Record<string, unknown> | null;
  occurredAt: string | Date;
  actorId?: string | null;
  actorLabel?: string | null;
  correlationId?: string | null;
}

export interface RawAuditRow {
  id: string;
  action: string;
  target: string;
  actorLabel?: string | null;
  actorId?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  createdAt: string | Date;
}

const SOURCES: ReadonlySet<string> = new Set([
  "MANUAL",
  "EMAIL",
  "CALL",
  "MEETING",
  "DOCUMENT",
  "CASE",
  "WORKFLOW",
  "SCREENING",
  "IMPORT",
  "SYSTEM",
]);

function toISO(value: string | Date): string {
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? new Date(0).toISOString()
      : value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? new Date(0).toISOString()
    : d.toISOString();
}

function parseMetadata(
  input: string | Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === "object") return input;
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readTransition(
  record: Record<string, unknown>
): StateTransition | null {
  const value = record["_transition"] ?? record["transition"];
  if (typeof value === "object" && value !== null) {
    const to = (value as Record<string, unknown>)["to"];
    if (typeof to === "string" && to.length > 0) {
      const from = (value as Record<string, unknown>)["from"];
      return { from: typeof from === "string" ? from : null, to };
    }
  }
  const from = readString(record, "_from") ?? readString(record, "from");
  const to = readString(record, "_to") ?? readString(record, "to");
  return to ? { from, to } : null;
}

/** Normalise one Activity row into a CaseActivity (envelope keys win over metadata). */
export function toCaseActivity(row: RawActivityRow): CaseActivity {
  const metadata = parseMetadata(row.metadata);
  const source = (
    row.source ??
    readString(metadata, "_source") ??
    "MANUAL"
  ).toUpperCase();
  return {
    id: row.id,
    orgId: row.orgId,
    caseId: row.caseId ?? null,
    contactId: row.contactId ?? null,
    leadId: row.leadId ?? null,
    kind: row.kind,
    summary: row.summary,
    actor: {
      id: row.actorId ?? readString(metadata, "_actorId"),
      label: row.actorLabel ?? readString(metadata, "_actorLabel") ?? "system",
      role: row.actorRole ?? readString(metadata, "_actorRole"),
    },
    source: SOURCES.has(source) ? (source as ActivitySource) : "MANUAL",
    timestamp: toISO(row.createdAt),
    correlationId: row.correlationId ?? readString(metadata, "_correlationId"),
    transition: row.transition ?? readTransition(metadata),
    auditEventId: row.auditEventId ?? readString(metadata, "_auditEventId"),
    metadata,
  };
}

function payloadFacts(
  payload: string | Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!payload) return {};
  if (typeof payload === "object") return payload;
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Project one hash-chained CaseEvent ledger row into a CaseActivity. */
export function caseEventToActivity(
  orgId: string,
  caseId: string,
  row: RawCaseEventRow
): CaseActivity {
  const facts = payloadFacts(row.payload);
  const from =
    typeof facts["from"] === "string" ? (facts["from"] as string) : null;
  const to = typeof facts["to"] === "string" ? (facts["to"] as string) : null;
  const docType =
    typeof facts["docType"] === "string" ? (facts["docType"] as string) : null;
  const source: ActivitySource =
    row.topic.startsWith("document.") || row.topic.startsWith("request.")
      ? "DOCUMENT"
      : row.topic.startsWith("message.")
      ? "EMAIL"
      : row.topic.startsWith("reminder.") ||
        row.topic.startsWith("booking.") ||
        row.topic.startsWith("triage.")
      ? "WORKFLOW"
      : "CASE";
  const summaryBits = [row.topic];
  if (docType) summaryBits.push(docType);
  if (from || to) summaryBits.push([from ?? "∅", to ?? "?"].join(" → "));
  const reason =
    typeof facts["reason"] === "string" ? (facts["reason"] as string) : null;
  return {
    id: `case-event:${row.id}`,
    orgId,
    caseId,
    contactId: null,
    leadId: null,
    kind: "STAGE",
    summary: reason
      ? `${summaryBits.join(" · ")} — ${reason}`
      : summaryBits.join(" · "),
    actor: {
      id: row.actorId ?? null,
      label: row.actorLabel ?? "system",
      role: null,
    },
    source,
    timestamp: toISO(row.occurredAt),
    correlationId: row.correlationId ?? null,
    transition: to ? { from, to } : null,
    auditEventId: null,
    metadata: { topic: row.topic, ...facts },
  };
}

// ── RFI turns as timeline facts (ADR-005 convergence) ──

/** Minimal structural RFI turn — mirrors the domain RfiTurn, no Prisma types. */
export interface RawRfiTurnRow {
  id: string;
  threadId: string;
  threadSubject: string;
  kind: "QUESTION" | "ANSWER" | "NOTE" | "SYSTEM";
  body: string;
  authorId?: string | null;
  authorLabel?: string | null;
  authorRole?: string | null;
  createdAt: string | Date;
  correlationId?: string | null;
}

/**
 * Project one RFI turn into a CaseActivity. The kind carries the turn kind
 * (`RFI_QUESTION` / `RFI_ANSWER` / `RFI_SYSTEM` / `RFI_NOTE`) so the
 * display projector can keep QUESTION/ANSWER/SYSTEM client-visible while
 * NOTE stays staff-only — enforced again in `toTimelineEvent`.
 */
export function rfiTurnToActivity(
  orgId: string,
  caseId: string,
  row: RawRfiTurnRow
): CaseActivity {
  const label =
    row.kind === "QUESTION"
      ? "RFI question"
      : row.kind === "ANSWER"
      ? "RFI answer"
      : row.kind === "NOTE"
      ? "RFI staff note"
      : "RFI record";
  return {
    id: `rfi-turn:${row.id}`,
    orgId,
    caseId,
    contactId: null,
    leadId: null,
    kind: `RFI_${row.kind}`,
    summary: `${label}: ${row.threadSubject} — ${row.body}`,
    actor: {
      id: row.authorId ?? null,
      label: row.authorLabel ?? "system",
      role: row.authorRole ?? null,
    },
    source: "CASE",
    timestamp: toISO(row.createdAt),
    correlationId: row.correlationId ?? `rfi-thread:${row.threadId}`,
    transition: null,
    auditEventId: null,
    metadata: { threadId: row.threadId, turnKind: row.kind },
  };
}

/** Minimal structural RFI thread for journey-event derivation. */
export interface RfiJourneyThread {
  subject: string;
  turns: Array<{ kind: string; body: string; createdAt: string }>;
}

/**
 * Derive client-safe journey events from RFI threads: QUESTION/ANSWER/SYSTEM
 * turns surface, NOTE turns (staff working notes) are withheld — the
 * JourneyBar is client-visible, so staff-only facts must never reach it.
 */
export function rfiThreadsToJourneyEvents(
  threads: RfiJourneyThread[]
): Array<{ title: string; timestamp: string; visibility: TimelineVisibility }> {
  const events: Array<{
    title: string;
    timestamp: string;
    visibility: TimelineVisibility;
  }> = [];
  for (const thread of threads) {
    for (const turn of thread.turns) {
      const kind = turn.kind.toUpperCase();
      if (kind === "NOTE") continue;
      const prefix =
        kind === "QUESTION"
          ? "Question"
          : kind === "ANSWER"
          ? "Answer"
          : "Update";
      const snippet =
        turn.body.length > 90 ? turn.body.slice(0, 87) + "…" : turn.body;
      events.push({
        title: `${prefix}: ${thread.subject} — ${snippet}`,
        timestamp: turn.createdAt,
        visibility: "both",
      });
    }
  }
  return events.sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
  );
}

// ── CaseTimelineEvent: display-ready projection ──

export type TimelineTone = "gold" | "red" | "neutral" | "green" | "blue";
export type TimelineVisibility = "staff" | "client" | "both";

export interface CaseTimelineEvent extends CaseActivity {
  displayTitle: string;
  tone: TimelineTone;
  visibility: TimelineVisibility;
}

const CLIENT_VISIBLE_KINDS: ReadonlySet<string> = new Set([
  "EMAIL",
  "MEETING",
  "DOCUMENT",
  "STAGE",
  "SYSTEM",
  // RFI convergence: questions, answers and machine records are shared with
  // the client; RFI_NOTE is deliberately absent (staff-only, see below).
  "RFI_QUESTION",
  "RFI_ANSWER",
  "RFI_SYSTEM",
]);

export function toTimelineEvent(activity: CaseActivity): CaseTimelineEvent {
  const kind = activity.kind.toUpperCase();
  const tone: TimelineTone =
    kind === "STAGE"
      ? "gold"
      : activity.transition?.to === "REJECTED" ||
        /reject|fail|breach|alert/i.test(activity.summary)
      ? "red"
      : kind === "DOCUMENT" || kind === "RFI_QUESTION"
      ? "blue"
      : kind === "RFI_ANSWER"
      ? "green"
      : kind === "TASK"
      ? "neutral"
      : /approv|complet|pass|clean/i.test(activity.summary)
      ? "green"
      : "neutral";
  const staffOnly =
    kind === "NOTE" ||
    kind === "RFI_NOTE" ||
    kind === "CALL" ||
    /internal|screening|four-eyes|countersign/i.test(activity.summary);
  return {
    ...activity,
    displayTitle:
      activity.summary.length > 140
        ? activity.summary.slice(0, 137) + "…"
        : activity.summary,
    tone,
    visibility: staffOnly
      ? "staff"
      : CLIENT_VISIBLE_KINDS.has(kind)
      ? "both"
      : "staff",
  };
}

/**
 * Merge normalised rows into one chronological stream (the Twenty "timeline
 * stream" pattern). Sorts ascending by timestamp and dedupes on correlationId
 * so an event fanned out to several ledgers renders once — the duplicate that
 * carries an auditEventId wins the linkage.
 */
export function projectCaseTimeline(
  activities: CaseActivity[]
): CaseTimelineEvent[] {
  const sorted = [...activities].sort((a, b) =>
    a.timestamp < b.timestamp
      ? -1
      : a.timestamp > b.timestamp
      ? 1
      : a.id < b.id
      ? -1
      : 1
  );
  const byCorrelation = new Map<string, CaseTimelineEvent>();
  const plain: CaseTimelineEvent[] = [];
  for (const activity of sorted) {
    const event = toTimelineEvent(activity);
    if (!event.correlationId) {
      plain.push(event);
      continue;
    }
    const existing = byCorrelation.get(event.correlationId);
    if (!existing) {
      byCorrelation.set(event.correlationId, event);
    } else if (!existing.auditEventId && event.auditEventId) {
      byCorrelation.set(event.correlationId, {
        ...existing,
        auditEventId: event.auditEventId,
      });
    }
  }
  const merged = [...plain, ...byCorrelation.values()];
  merged.sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
  );
  return merged;
}

/** Attach audit-trail linkage to timeline events via shared correlationId. */
export function joinAuditToTimeline(
  events: CaseTimelineEvent[],
  audits: RawAuditRow[]
): CaseTimelineEvent[] {
  const byCorrelation = new Map<string, string>();
  for (const audit of audits) {
    if (audit.correlationId && !byCorrelation.has(audit.correlationId)) {
      byCorrelation.set(audit.correlationId, audit.id);
    }
  }
  if (byCorrelation.size === 0) return events;
  return events.map((event) =>
    !event.auditEventId &&
    event.correlationId &&
    byCorrelation.has(event.correlationId)
      ? { ...event, auditEventId: byCorrelation.get(event.correlationId)! }
      : event
  );
}

// ── Relationship metadata (EspoCRM "relations" pattern) ──

export type RelationEntity = "CONTACT" | "CASE" | "LEAD" | "TASK";
export type RelationProvenance =
  | "MANUAL"
  | "LEAD_PROMOTION"
  | "CASE_OPEN"
  | "IMPORT"
  | "SYSTEM";

export interface RelationLink {
  fromType: RelationEntity;
  fromId: string;
  toType: RelationEntity;
  toId: string;
  /** The role this link plays: PRIMARY_APPLICANT | DEPENDANT | OWNER | WATCHER | RELATED … */
  role: string;
  provenance: RelationProvenance;
  since: string;
}

export function linkContactToCase(
  contactId: string,
  caseId: string,
  role: string,
  provenance: RelationProvenance,
  since: string | Date = new Date()
): RelationLink {
  return {
    fromType: "CONTACT",
    fromId: contactId,
    toType: "CASE",
    toId: caseId,
    role: role.trim().toUpperCase().slice(0, 40) || "RELATED",
    provenance,
    since: toISO(since),
  };
}

/** Every link touching an entity, newest first. */
export function relationsFor(
  entityType: RelationEntity,
  entityId: string,
  links: RelationLink[]
): RelationLink[] {
  return links
    .filter(
      (link) =>
        (link.fromType === entityType && link.fromId === entityId) ||
        (link.toType === entityType && link.toId === entityId)
    )
    .sort((a, b) => (a.since < b.since ? 1 : a.since > b.since ? -1 : 0));
}

// ── Field-level PII visibility (EspoCRM per-role field permissions pattern) ──

export interface ContactFacts {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
}

export type FieldVisibility = "full" | "masked" | "hidden";

export interface MaskedContact extends ContactFacts {
  visibility: Record<
    "name" | "email" | "phone" | "company" | "notes",
    FieldVisibility
  >;
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return "—";
  const at = value.indexOf("@");
  if (at <= 1) return "«email»";
  return `${value.slice(0, 1)}***@${value.slice(at + 1)}`;
}

export function maskPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "«phone»";
  return `+${"*".repeat(Math.max(digits.length - 4, 3))}${digits.slice(-4)}`;
}

/**
 * Role-gated contact view. ADMIN / SENIOR_RM / RM work the case and see full
 * facts; AUDITOR sees masked values (shape preserved for verification);
 * CLIENT / PARTNER see identity only — contact details and notes stay hidden.
 */
export function maskContactForRole(
  contact: ContactFacts,
  role: ViewerRole
): MaskedContact {
  if (role === "ADMIN" || role === "SENIOR_RM" || role === "RM") {
    return {
      ...contact,
      visibility: {
        name: "full",
        email: "full",
        phone: "full",
        company: "full",
        notes: "full",
      },
    };
  }
  if (role === "AUDITOR") {
    return {
      id: contact.id,
      name: contact.name,
      email: maskEmail(contact.email),
      phone: maskPhone(contact.phone),
      company: contact.company ?? null,
      notes: contact.notes ? "«redacted — staff note»" : null,
      visibility: {
        name: "full",
        email: "masked",
        phone: "masked",
        company: "full",
        notes: "masked",
      },
    };
  }
  return {
    id: contact.id,
    name: contact.name,
    email: null,
    phone: null,
    company: contact.company ?? null,
    notes: null,
    visibility: {
      name: "full",
      email: "hidden",
      phone: "hidden",
      company: "full",
      notes: "hidden",
    },
  };
}

// ── Configurable views (Twenty "configurable views" pattern) ──

export interface ViewRow {
  id: string;
  status: string;
  dataApproval: string | null;
  serviceApproval: string | null;
  programme: { name: string; country: string } | null;
  openRequests: number;
  riskFlag?: string;
  assigneeId?: string | null;
  updatedAt?: string;
}

export type ViewFilterOp = "eq" | "neq" | "gt" | "lt" | "in" | "recentDays";

export interface CrmViewFilter {
  field:
    | "status"
    | "dataApproval"
    | "serviceApproval"
    | "assigneeId"
    | "riskFlag"
    | "openRequests"
    | "updatedAt";
  op: ViewFilterOp;
  value: string | number | Array<string | null> | null;
}

export interface CrmViewDef {
  key: string;
  label: string;
  /** SYSTEM ships with the product; ORG is admin-saved; PERSONAL is the RM's own. */
  scope: "SYSTEM" | "ORG" | "PERSONAL";
  ownerId?: string | null;
  filters: CrmViewFilter[];
  sort: { field: "updatedAt" | "openRequests" | "status"; dir: "asc" | "desc" };
  columns: string[];
}

const BASE_COLUMNS = [
  "reference",
  "client",
  "programme",
  "status",
  "approvals",
  "docs",
  "rm",
  "updatedAt",
];

export const SYSTEM_CRM_VIEWS: CrmViewDef[] = [
  {
    key: "all",
    label: "All cases",
    scope: "SYSTEM",
    filters: [],
    sort: { field: "updatedAt", dir: "desc" },
    columns: BASE_COLUMNS,
  },
  {
    key: "needs-action",
    label: "Needs action",
    scope: "SYSTEM",
    filters: [
      { field: "status", op: "neq", value: "COMPLETED" },
      { field: "status", op: "neq", value: "CANCELLED" },
      { field: "dataApproval", op: "in", value: ["PENDING", null] },
    ],
    sort: { field: "updatedAt", dir: "desc" },
    columns: BASE_COLUMNS,
  },
  {
    key: "docs-pending",
    label: "Documents pending",
    scope: "SYSTEM",
    filters: [{ field: "openRequests", op: "gt", value: 0 }],
    sort: { field: "openRequests", dir: "desc" },
    columns: BASE_COLUMNS,
  },
  {
    key: "recent-7d",
    label: "Updated this week",
    scope: "SYSTEM",
    filters: [{ field: "updatedAt", op: "recentDays", value: 7 }],
    sort: { field: "updatedAt", dir: "desc" },
    columns: BASE_COLUMNS,
  },
  {
    key: "high-risk",
    label: "High risk",
    scope: "SYSTEM",
    filters: [{ field: "riskFlag", op: "eq", value: "HIGH" }],
    sort: { field: "updatedAt", dir: "desc" },
    columns: BASE_COLUMNS,
  },
];

function fieldValue(
  row: ViewRow,
  field: CrmViewFilter["field"]
): string | number | null {
  switch (field) {
    case "status":
      return row.status;
    case "dataApproval":
      return row.dataApproval;
    case "serviceApproval":
      return row.serviceApproval;
    case "assigneeId":
      return row.assigneeId ?? null;
    case "riskFlag":
      return row.riskFlag ?? "NONE";
    case "openRequests":
      return row.openRequests;
    case "updatedAt":
      return row.updatedAt ?? null;
  }
}

function matchesFilter(row: ViewRow, filter: CrmViewFilter): boolean {
  const actual = fieldValue(row, filter.field);
  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "gt":
      return (
        typeof actual === "number" &&
        typeof filter.value === "number" &&
        actual > filter.value
      );
    case "lt":
      return (
        typeof actual === "number" &&
        typeof filter.value === "number" &&
        actual < filter.value
      );
    case "in":
      return (
        Array.isArray(filter.value) &&
        (filter.value as (string | null)[]).includes(actual as string | null)
      );
    case "recentDays": {
      if (typeof actual !== "string" || typeof filter.value !== "number")
        return false;
      const at = new Date(actual).getTime();
      if (Number.isNaN(at)) return false;
      return Date.now() - at <= filter.value * 86_400_000;
    }
  }
}

/** Apply a saved view definition to queue rows: AND over filters, then the view sort. */
export function applyCrmView<T extends ViewRow>(
  rows: T[],
  view: CrmViewDef
): T[] {
  const filtered = rows.filter((row) =>
    view.filters.every((filter) => matchesFilter(row, filter))
  );
  const dir = view.sort.dir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (view.sort.field === "openRequests")
      return (a.openRequests - b.openRequests) * dir;
    const av = a.updatedAt ?? "";
    const bv = b.updatedAt ?? "";
    if (view.sort.field === "status")
      return (a.status < b.status ? -1 : a.status > b.status ? 1 : 0) * dir;
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });
}

// ── Unified search (one box over contacts, cases, leads, tasks, activities) ──

export type SearchEntity = "CONTACT" | "CASE" | "LEAD" | "TASK" | "ACTIVITY";

export interface CrmSearchHit {
  entityType: SearchEntity;
  id: string;
  title: string;
  subtitle: string;
  matchedField: string;
  score: number;
}

export interface CrmSearchCollections {
  contacts: Array<{
    id: string;
    name: string;
    email?: string | null;
    company?: string | null;
  }>;
  cases: Array<{ id: string; reference: string; clientName?: string | null }>;
  leads: Array<{ id: string; name: string; email: string }>;
  tasks: Array<{ id: string; title: string }>;
  activities: Array<{ id: string; summary: string; kind: string }>;
}

const MAX_HITS = 25;

function scoreMatch(
  haystack: string,
  tokens: string[],
  weight: number
): number {
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (lower === token) score += weight * 3;
    else if (lower.startsWith(token)) score += weight * 2;
    else if (lower.includes(token)) score += weight;
  }
  return score;
}

/** Token-AND ranked search; every token must match somewhere in the hit. Empty query → []. */
export function searchCrm(
  query: string,
  collections: CrmSearchCollections
): CrmSearchHit[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return [];
  const hits: CrmSearchHit[] = [];
  const consider = (
    entityType: SearchEntity,
    id: string,
    title: string,
    subtitle: string,
    fields: Array<[string, string, number]>
  ) => {
    let score = 0;
    let matchedField = "";
    let matchedWeight = 0;
    for (const [field, value, weight] of fields) {
      const lower = value.toLowerCase();
      const allHit = tokens.every((token) => lower.includes(token));
      if (!allHit) continue;
      const fieldScore = scoreMatch(value, tokens, weight);
      if (fieldScore > 0 && weight >= matchedWeight) {
        matchedField = field;
        matchedWeight = weight;
      }
      score += fieldScore;
    }
    if (score > 0)
      hits.push({ entityType, id, title, subtitle, matchedField, score });
  };
  for (const c of collections.contacts) {
    consider("CONTACT", c.id, c.name, c.company ?? c.email ?? "", [
      ["name", c.name, 5],
      ["email", c.email ?? "", 3],
      ["company", c.company ?? "", 2],
    ]);
  }
  for (const c of collections.cases) {
    consider("CASE", c.id, c.reference, c.clientName ?? "", [
      ["reference", c.reference, 5],
      ["clientName", c.clientName ?? "", 3],
    ]);
  }
  for (const l of collections.leads) {
    consider("LEAD", l.id, l.name, l.email, [
      ["name", l.name, 5],
      ["email", l.email, 3],
    ]);
  }
  for (const t of collections.tasks) {
    consider("TASK", t.id, t.title, "", [["title", t.title, 4]]);
  }
  for (const a of collections.activities) {
    consider("ACTIVITY", a.id, a.summary.slice(0, 80), a.kind, [
      ["summary", a.summary, 2],
    ]);
  }
  return hits
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_HITS);
}

// ── FS-7: welcome + checklist tiles per ApplicantRole ──

export type ApplicantRole = "PRIMARY" | "SPOUSE" | "CHILD" | "PARENT" | "OTHER";

export interface RoleTile {
  key: string;
  title: string;
  detail: string;
  required: boolean;
}

const PRIMARY_TILES: RoleTile[] = [
  {
    key: "profile",
    title: "Complete your profile",
    detail: "Personal details, nationality and contact information.",
    required: true,
  },
  {
    key: "identity",
    title: "Identity documents",
    detail: "Passport copy with a live MRZ read at upload.",
    required: true,
  },
  {
    key: "funds",
    title: "Source-of-funds questionnaire",
    detail: "Suitability questions the desk reviews before service selection.",
    required: true,
  },
  {
    key: "programme",
    title: "Choose your programme",
    detail: "Compare options, then confirm your service selection.",
    required: true,
  },
  {
    key: "review",
    title: "Review and sign",
    detail: "Confirm the prepared dossier before dispatch.",
    required: true,
  },
];

const ROLE_TILE_ADDITIONS: Record<
  Exclude<ApplicantRole, "PRIMARY">,
  RoleTile[]
> = {
  SPOUSE: [
    {
      key: "spouse-identity",
      title: "Spouse identity",
      detail: "Passport or national ID for the spouse applicant.",
      required: true,
    },
    {
      key: "spouse-police",
      title: "Spouse police record",
      detail: "Issued within the last 90 days.",
      required: true,
    },
    {
      key: "marriage",
      title: "Marriage certificate",
      detail: "Proof of the qualifying relationship.",
      required: true,
    },
  ],
  CHILD: [
    {
      key: "child-birth",
      title: "Birth certificate",
      detail: "Proof of parentage for the child applicant.",
      required: true,
    },
    {
      key: "child-passport",
      title: "Child passport",
      detail: "Identity document for the child applicant.",
      required: true,
    },
    {
      key: "guardian-consent",
      title: "Guardian consent",
      detail: "Required when only one parent is the applicant.",
      required: false,
    },
  ],
  PARENT: [
    {
      key: "parent-identity",
      title: "Parent identity",
      detail: "Passport or national ID for the parent applicant.",
      required: true,
    },
    {
      key: "dependency",
      title: "Dependency proof",
      detail: "Evidence the parent is principally dependent on the applicant.",
      required: true,
    },
    {
      key: "parent-police",
      title: "Parent police record",
      detail: "Issued within the last 90 days.",
      required: true,
    },
  ],
  OTHER: [
    {
      key: "other-identity",
      title: "Identity document",
      detail: "Passport or national ID for this applicant.",
      required: true,
    },
    {
      key: "other-proof",
      title: "Relationship proof",
      detail: "Evidence of the qualifying link to the primary applicant.",
      required: false,
    },
  ],
};

/** FS-7 checklist tiles: the primary track plus the role-specific additions. Unknown roles → primary track. */
export function roleTilesFor(role: string): RoleTile[] {
  const upper = role.trim().toUpperCase();
  if (upper === "PRIMARY") return [...PRIMARY_TILES];
  const additions = (ROLE_TILE_ADDITIONS as Record<string, RoleTile[]>)[upper];
  return additions
    ? [...PRIMARY_TILES.slice(0, 2), ...additions]
    : [...PRIMARY_TILES];
}

// ── FS-11: at most one bundled update per day ──

export interface DailyBundleItem {
  caseId: string | null;
  caseRef: string;
  title: string;
  timestamp: string;
  tone: TimelineTone;
}

export interface DailyBundle {
  /** Calendar day the bundle covers (YYYY-MM-DD). */
  date: string;
  progressPct: number;
  whatsNew: DailyBundleItem[];
  dueNext: string[];
  unreadCount: number;
  truncated: boolean;
}

export interface DailyBundleInput {
  date: string;
  progressPct: number;
  events: CaseTimelineEvent[];
  dueNext?: string[];
  unreadCount?: number;
  maxItems?: number;
}

/**
 * FS-11 daily bundle: collapse a day of timeline events into a single digest
 * with the current progress percentage. Newest first, capped (default 8) with
 * an explicit truncation flag so the UI can say "and N more" honestly.
 */
export function buildDailyBundle(input: DailyBundleInput): DailyBundle {
  const max = Math.max(input.maxItems ?? 8, 1);
  const sorted = [...input.events].sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0
  );
  const items: DailyBundleItem[] = sorted.map((event) => ({
    caseId: event.caseId,
    caseRef:
      typeof event.metadata["caseRef"] === "string"
        ? (event.metadata["caseRef"] as string)
        : "—",
    title: event.displayTitle,
    timestamp: event.timestamp,
    tone: event.tone,
  }));
  const truncated = items.length > max;
  return {
    date: input.date,
    progressPct: Math.min(Math.max(Math.round(input.progressPct), 0), 100),
    whatsNew: truncated ? items.slice(0, max) : items,
    dueNext: (input.dueNext ?? []).slice(0, 5),
    unreadCount: Math.max(input.unreadCount ?? items.length, 0),
    truncated,
  };
}
