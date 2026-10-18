/**
 * Typed API client — single contract for all feature UIs.
 * All requests relative-path only. Errors throw ApiError with status.
 */
import type { BusinessConfig } from "@/lib/business/defaults";
import type { CanonBrand } from "@/lib/brand/defaults";
import type { PlatformSettings } from "@/lib/settings/registry";

export class ApiError extends Error {
  status: number;
  /** Stable machine-readable code from the error envelope (`internal_error`, `rate_limited`, …). */
  errorCode: string | null;
  /** Correlates a user-reported failure to a specific server request. */
  correlationId: string | null;
  constructor(
    message: string,
    status: number,
    errorCode: string | null = null,
    correlationId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.correlationId = correlationId;
  }
}

// ── bearer session token ──
// The preview panel (and some portal SSOs) render the app inside a cross-origin
// iframe where browsers block SameSite cookies entirely. Headers are not subject
// to SameSite rules, so we keep the session token here and send it on every call.
// The httpOnly cookie remains in place for normal top-level browsing.
const TOKEN_KEY = "cl_session_token";

function readStoredToken(): string | null {
  try {
    return globalThis.window === undefined
      ? null
      : window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage unavailable (sandboxed) — cookie path only
  }
}

function storeToken(token: string | null) {
  try {
    if (globalThis.window === undefined) return;
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}

let bearerToken = readStoredToken();

export function currentSessionToken(): string | null {
  return bearerToken;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (bearerToken) h["authorization"] = `Bearer ${bearerToken}`;
  return h;
}

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...authHeaders(),
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      credentials: "same-origin",
    });
  } catch {
    // fetch() rejects on DNS failure, refused connection, offline, or a blocked
    // request. Surface that as a typed ApiError so callers can show "check your
    // connection" instead of the browser's raw "Failed to fetch".
    throw new ApiError("Network request failed", 0, "network_error", null);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    // Product telemetry — API failure visibility (best-effort, never throws).
    void import("@/lib/telemetry/client")
      .then((m) => m.trackApi(path, res.status, Date.now() - started))
      .catch(() => undefined);
    const body = data as {
      error?: string;
      errorCode?: string;
      correlationId?: string;
    } | null;
    const message = body?.error ?? `Request failed (${res.status})`;
    throw new ApiError(
      message,
      res.status,
      body?.errorCode ?? null,
      body?.correlationId ?? null,
    );
  }
  return data as T;
}

// ── in-flight de-duplication + micro-cache for GETs ──
// Many surfaces poll the same endpoints (the notification bell every 15s,
// several components reading the same case). Identical GETs share one request
// and a 3s result cache, so bursts collapse into a single round-trip. Any
// mutation clears the cache so a write is never followed by stale reads.
const inflightGets = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { at: number; data: unknown }>();
const GET_CACHE_TTL_MS = 3_000;
/** Hard cap — a read-only session must not accumulate cache entries forever. */
const GET_CACHE_MAX_ENTRIES = 500;

function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return rawRequest<T>(path, init).then((data) => {
      getCache.clear();
      return data;
    });
  }
  if (getCache.size > GET_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of getCache) {
      if (now - v.at >= GET_CACHE_TTL_MS) getCache.delete(k);
    }
    // Still over the cap — evict oldest-inserted keys (Map preserves insertion order).
    while (getCache.size > GET_CACHE_MAX_ENTRIES) {
      const oldest = getCache.keys().next().value;
      if (oldest === undefined) break;
      getCache.delete(oldest);
    }
  }
  const cached = getCache.get(path);
  if (cached && Date.now() - cached.at < GET_CACHE_TTL_MS)
    return Promise.resolve(cached.data as T);
  const pending = inflightGets.get(path);
  if (pending) return pending as Promise<T>;
  const p = rawRequest<T>(path, init)
    .then((data) => {
      getCache.set(path, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflightGets.delete(path);
    });
  inflightGets.set(path, p);
  return p;
}

// ── binary GETs ──
// Auth-gated streams (voice-note recordings) cannot ride an <audio src>, so the
// bytes are fetched through the same bearer + same-origin path as every request.
async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...authHeaders(),
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network request failed", 0, "network_error", null);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let errorCode: string | null = null;
    let correlationId: string | null = null;
    try {
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        correlationId?: string;
      };
      if (data?.error) message = data.error;
      errorCode = data?.errorCode ?? null;
      correlationId = data?.correlationId ?? null;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(message, res.status, errorCode, correlationId);
  }
  return res.blob();
}

export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const get = <T>(path: string) => request<T>(path);
export const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

// ── shared types ──
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "CLIENT" | "RM" | "SENIOR_RM" | "ADMIN" | "AUDITOR";
  profileState: string;
  emailVerifiedAt?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

export type ExtractedField = {
  id: string;
  fieldKey: string;
  value: string | null;
  confidence: number;
  edited: boolean;
  source: string;
};
export type DocumentRow = {
  id: string;
  type: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  version: number;
  scanStatus: string;
  createdAt: string;
  fields: ExtractedField[];
  reviews: Array<{
    id: string;
    decision: string;
    reason: string;
    createdAt: string;
    reviewer: { name: string; role: string };
  }>;
  ocrJobs?: Array<{
    id: string;
    status: string;
    provider: string;
    confidence: number | null;
    error: string | null;
  }>;
  comments?: Array<{
    id: string;
    body: string;
    createdAt: string;
    internal: boolean;
    author: { name: string; role: string };
  }>;
};
export type RequestRow = {
  id: string;
  docType: string;
  title: string;
  instructions: string;
  dueDate: string | null;
  status: string;
  flexible: boolean;
  createdAt: string;
  documents: Array<{ id: string; status: string }>;
};
export type CaseView = {
  id: string;
  reference: string;
  status: string;
  dataApproval: string | null;
  serviceApproval: string | null;
  programme: {
    id: string;
    key: string;
    name: string;
    country: string;
    description: string;
  } | null;
  createdAt: string;
  rm: { id: string; name: string; email: string } | null;
  documents: DocumentRow[];
  requests: RequestRow[];
  timeline: Array<{
    id: string;
    from: string | null;
    to: string;
    reason: string | null;
    command: string | null;
    createdAt: string;
  }>;
  dispatches: Array<{
    id: string;
    carrier: string;
    trackingId: string;
    destination: string;
    status: string;
    dispatchedAt: string | null;
    followUps: Array<{
      id: string;
      dueDate: string;
      status: string;
      note: string | null;
    }>;
  }>;
  letter: {
    id: string;
    fileName: string;
    sizeBytes: number;
    createdAt: string;
  } | null;
};

export type Programme = {
  id: string;
  key: string;
  name: string;
  country: string;
  description: string;
};
/** Admin view of a programme — the client-facing fields plus lifecycle state. */
export type AdminProgramme = Programme & { active: boolean };
/** Admin-managed notification copy with {{token}} interpolation. */
export type MessageTemplate = {
  id: string;
  key: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  locale: string;
  active: boolean;
  updatedAt: string;
};

// ── eligibility pre-scan (indicative screening) ──
export type PrescanAnswers = {
  nationalityZone?: "EU_EFTA" | "NON_EU";
  fundsChf?: number;
  ageYears?: number;
  permit?: "NONE" | "L" | "B" | "C";
  residenceYears?: number;
  employmentMonths?: number;
  willWorkInSwitzerland?: boolean;
  livesInBorderZone?: boolean;
};

export type PrescanOutcome =
  "ELIGIBLE" | "CONDITIONS" | "NOT_ELIGIBLE" | "NOT_SCREENABLE";

export type PrescanFactor = {
  rule: string;
  label: string;
  result: "PASS" | "FAIL" | "UNKNOWN";
  detail: string;
};

export type PrescanResult = {
  outcome: PrescanOutcome;
  factors: PrescanFactor[];
  serviceName: string;
  summary: string;
  nextSteps: string[];
};

/**
 * The case AGAINST approval, as grounds the desk rebuts one by one. Advisory —
 * it re-projects the screening rules and the programme catalogue, and only ever
 * argues what those encode.
 */
export type CounterGround = {
  id: string;
  kind:
    | "rule"
    | "unknown"
    | "watchFactor"
    | "screening"
    | "obligation"
    | "currency";
  severity: "BLOCKER" | "MATERIAL" | "MINOR";
  statement: string;
  rebuttal: string;
  provenance: string;
  documentKey?: string;
};
export type CounterCase = {
  programmeKey: string;
  serviceName: string;
  thesis: string;
  grounds: CounterGround[];
  /** Nothing could be argued — which is NOT an approval. */
  insufficientBasis: boolean;
  toRequest: string[];
};

export type PrescanResponse = {
  mode: "programme" | "ranked";
  indicative: true;
  note: string;
  programmeKey?: string;
  programmeLabel?: string;
  /** present in programme mode */
  outcome?: PrescanOutcome;
  factors?: PrescanFactor[];
  summary?: string;
  nextSteps?: string[];
  /** present in programme mode — the adversarial counter-case */
  counterCase?: CounterCase;
  /** present in ranked mode */
  recommendations?: Array<PrescanResult & { key: string }>;
};

// ── source-of-funds questionnaire ──
export type SofSourceCategory =
  "EMPLOYMENT" | "BUSINESS" | "INHERITANCE" | "INVESTMENT" | "CRYPTO" | "OTHER";

export type SofSubmission = {
  sourceCategory: SofSourceCategory;
  description: string;
  estimatedAmountChf: number | null;
  evidenceLinks: string[];
  declaration: true;
  submittedAt: string;
  submittedBy: string;
  submittedByLabel: string;
  revision: number;
};

export type CallRow = {
  id: string;
  caseId: string;
  caseReference: string;
  kind: "AUDIO" | "VIDEO";
  status: string;
  callerRole: "CLIENT" | "STAFF";
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  counterparty: { name: string; role: string } | null;
};

// ── triage (org-scoped prioritised active-case queue) ──
export type TriageTier = "P1" | "P2" | "P3";
export type TriageScore = {
  caseId: string;
  reference: string;
  tier: TriageTier;
  score: number;
  factors: string[];
  /**
   * Dwell pressure over the current stage's SLA (see `@/lib/domain/dwell`).
   * `null` when the case is within SLA or its state maps to no lifecycle stage.
   */
  dwell?: {
    party: string;
    overdueDays: number;
    cost: number;
    reason: string;
  } | null;
};

export type TeamRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: string;
  memberCount: number;
  isMember: boolean;
  myRole: "LEADER" | "MEMBER" | null;
  lastMessageAt: string | null;
  unread: number;
  archived: boolean;
};

export type TeamMessageRow = {
  id: string;
  teamId: string;
  body: string;
  kind: string;
  author: { id: string; name: string; role: string };
  createdAt: string;
  audioBytes: number | null;
  audioDurationMs: number | null;
  transcriptStatus: string;
  transcript: string | null;
  hasAudio: boolean;
  mine: boolean;
};

export type MeetingRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  teamId: string | null;
  caseId: string | null;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  participants: Array<{
    userId: string;
    name: string;
    role: string;
    micOn: boolean;
    cameraOn: boolean;
    joinedAt: string;
  }>;
  myRole: "HOST" | "MEMBER";
  maxParticipants: number;
  recordingBytes: number | null;
  recordingDurationMs: number | null;
  transcriptStatus: string;
};

export type ManifestField = {
  key: string;
  type: string;
  label: string;
  default: unknown;
};
export type ManifestSection = {
  key: string;
  title: string;
  readRoles: string[];
  writeRoles: string[];
  fields: ManifestField[];
};
export type ManifestGovernance = {
  controller: { role: string; note: string; dpoNote: string };
  activities: Array<{
    id: string;
    name: string;
    lawfulBasis: string;
    dataClass: string;
    retentionDays: number | null;
    legalHold: boolean;
  }>;
  purgeTier: Array<{ model: string; days: number }>;
};
export type Manifest = {
  version: string;
  settings: ManifestSection[];
  webhooks: { topics: string[] };
  events: { topics: string[] };
  integrations: { keys: string[] };
  governance: ManifestGovernance;
};

export type Ropa = {
  generatedAt: string;
  controller: { role: string; note: string; dpoNote: string };
  activities: Array<Record<string, unknown>>;
  purgeTier: Array<{ model: string; days: number }>;
  legalHold: Array<{ model: string; basis: string }>;
  engagementLifetime: string[];
};

export type RetentionRunResult = {
  dryRun: boolean;
  results: Array<{ model: string; days: number; deleted: number }>;
};

// ── autopilot (auto-detected / auto-generated inbound hook endpoints) ──
export type AutopilotEndpoint = {
  id: string;
  workflowId: string;
  workflowName: string;
  label: string;
  url: string;
  token: string;
  active: boolean;
  source: string;
  calls: number;
  lastUsedAt: string | null;
  createdAt: string;
  secretHint: string;
};
export type AutopilotResource = {
  workflowId: string;
  name: string;
  description: string;
  published: boolean;
  disabled: boolean;
  triggerKey: string | null;
  triggerLabel: string | null;
  predictedTopics: string[];
  rationale: string;
  hookId: string | null;
  token: string | null;
  url: string | null;
  active: boolean;
  calls: number;
  lastUsedAt: string | null;
};
export type AutopilotPlanItem = {
  workflowId: string;
  name: string;
  action: "create" | "repair" | "none";
  detail: string;
};
export type AutopilotSnapshot = {
  resources: AutopilotResource[];
  plan: AutopilotPlanItem[];
  endpoints: AutopilotEndpoint[];
  topics: string[];
};
export type AutopilotProvisionResult = {
  outcomes: Array<{
    workflowId: string;
    name: string;
    created: boolean;
    url: string;
    hookId: string;
    secret: string | null;
  }>;
  created: number;
  repaired: number;
  endpoints: AutopilotEndpoint[];
};

// ── automation durable queue / dead-letter queue ──
export type AutomationQueueStats = {
  queued: number;
  running: number;
  succeeded: number;
  dead: number;
  deadBySeverity: Record<string, number>;
  maxConcurrent: number;
  paused: boolean;
};
export type AutomationDeadJob = {
  id: string;
  topic: string;
  attempts: number;
  maxAttempts: number;
  severity: "NONE" | "MEDIUM" | "HIGH" | "CRITICAL";
  lastError: string | null;
  correlationId: string | null;
  failureCategory?: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type AutomationAlert = {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  message: string;
  createdAt: string;
  acknowledged: boolean;
};

// ── watchlist matching (sanctions/PEP screening query) ──
/** One matcher hit, merged across the queried name variants. */
export type ScreeningsMatchHit = {
  id: string;
  caption: string;
  schema: string;
  score: number;
  datasets: string[];
  /** The variant strings this entity answered to — the reason it surfaced. */
  matchedVia: string[];
  /** The screening keys of the canonical (first) variant, for the record. */
  keys: string;
};
export type ScreeningsMatch = {
  dataset: string;
  queries: string[];
  hits: ScreeningsMatchHit[];
  /** True when at least one variant failed — the union may be incomplete. */
  degraded: boolean;
  datasets: string[];
  /** The reader's next step: a human records the outcome. */
  notice: string;
};

export const api = {
  // auth — login returns the session token for bearer fallback (iframe-safe)
  login: (email: string, password: string) =>
    post<{ user: SessionUser; token: string }>("/api/auth/login", {
      email,
      password,
    }).then((data) => {
      bearerToken = data.token;
      storeToken(data.token);
      return data;
    }),
  logout: () =>
    post("/api/auth/logout").then((data) => {
      bearerToken = null;
      storeToken(null);
      return data;
    }),
  session: () => get<{ user: SessionUser | null }>("/api/auth/session"),
  register: (p: {
    name: string;
    email: string;
    password: string;
    locale?: string;
    consent: boolean;
  }) =>
    post<{
      user: SessionUser;
      token: string;
      verification: {
        sent: boolean;
        channel: string;
        detail: string;
        sandboxLink: string | null;
        expiresAt: string;
      };
    }>("/api/auth/register", p).then((d) => {
      bearerToken = d.token;
      storeToken(d.token);
      return d;
    }),
  verifyEmail: (token: string) =>
    post<{ ok: boolean; email?: string }>("/api/auth/verify-email", { token }),
  resendVerification: (email?: string) =>
    post<{
      ok: boolean;
      alreadyVerified?: boolean;
      verification?: {
        sent: boolean;
        channel: string;
        detail: string;
        sandboxLink: string | null;
        expiresAt: string;
      };
    }>("/api/auth/resend-verification", { email }),
  forgotPassword: (email: string) =>
    post<{ ok: true; sandboxLink: string | null }>(
      "/api/auth/forgot-password",
      { email },
    ),
  resetPassword: (token: string, password: string) =>
    post<{ ok: boolean; email?: string }>("/api/auth/reset-password", {
      token,
      password,
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>("/api/auth/change-password", {
      currentPassword,
      newPassword,
    }),
  // passwordless sign-in — request a one-time link, then consume it for a session
  requestMagicLink: (email: string, locale?: string) =>
    post<{ ok: true; sandboxLink: string | null }>("/api/auth/magic-link", {
      email,
      locale,
    }),
  verifyMagicLink: (token: string) =>
    post<{ user: SessionUser; token: string }>("/api/auth/verify-magic-link", {
      token,
    }).then((data) => {
      bearerToken = data.token;
      storeToken(data.token);
      return data;
    }),

  // client
  myCase: () => get<{ case: CaseView | null }>("/api/me/case"),
  profile: () =>
    get<{
      profile: {
        id: string;
        email: string;
        name: string;
        role: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        address: string | null;
        city: string | null;
        country: string | null;
        nationality: string | null;
        dateOfBirth: string | null;
      };
    }>("/api/me/profile"),
  updateProfile: (p: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    nationality?: string;
    dateOfBirth?: string;
  }) =>
    patch<{
      profile: {
        id: string;
        name: string;
        phone: string | null;
        address: string | null;
        city: string | null;
        country: string | null;
        nationality: string | null;
        dateOfBirth: string | null;
      };
    }>("/api/me/profile", p),
  gdprExport: () => get<Record<string, unknown>>("/api/me/gdpr"),
  gdprErasure: (reason?: string) =>
    post<{ received: boolean; note: string }>("/api/me/gdpr", {
      action: "erasure-request",
      reason,
    }),
  // Your own active sessions — see where you are still signed in.
  sessions: () =>
    get<{
      sessions: Array<{
        id: string;
        createdAt: string;
        expiresAt: string;
        current: boolean;
      }>;
    }>("/api/me/sessions"),
  revokeSession: (id: string) =>
    post<{
      revoked: number;
      sessions: Array<{
        id: string;
        createdAt: string;
        expiresAt: string;
        current: boolean;
      }>;
    }>("/api/me/sessions", { action: "revoke", id }),
  revokeOtherSessions: () =>
    post<{
      revoked: number;
      sessions: Array<{
        id: string;
        createdAt: string;
        expiresAt: string;
        current: boolean;
      }>;
    }>("/api/me/sessions", { action: "revoke-others" }),
  caseDetail: (id: string) =>
    get<{
      case: CaseView & {
        client: {
          id: string;
          name: string;
          email: string;
          firstName: string | null;
          lastName: string | null;
          dateOfBirth: string | null;
          nationality: string | null;
          phone: string | null;
          address: string | null;
          city: string | null;
          country: string | null;
          profileState: string;
        };
        assignments: Array<{
          id: string;
          role: string;
          user: { id: string; name: string; email: string; role: string };
        }>;
        letters: Array<{
          id: string;
          fileName: string;
          version: number;
          createdAt: string;
        }>;
      };
    }>(`/api/cases/${id}`),
  submitProfile: (p: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationality: string;
    phone: string;
    address: string;
    city: string;
    country: string;
  }) =>
    post<{ case: { id: string; reference: string } }>(
      "/api/onboarding/profile",
      p,
    ),
  programmes: () => get<{ programmes: Programme[] }>("/api/programmes"),
  selectService: (caseId: string, programmeId: string, acknowledged: boolean) =>
    post(`/api/cases/${caseId}/service`, { programmeId, acknowledged }),
  uploadDocument: (p: {
    type: string;
    fileName: string;
    mimeType: string;
    dataBase64: string;
    requestId?: string;
    caseId?: string;
  }) =>
    post<{
      document: { id: string; status: string };
      ocr: {
        provider: string;
        confidence: number;
        error: string | null;
        provisional: boolean;
      };
    }>("/api/documents/upload", p),
  document: (id: string) =>
    get<{ document: DocumentRow }>(`/api/documents/${id}`),
  correctFields: (
    id: string,
    fields: Array<{ fieldKey: string; value: string }>,
  ) => patch(`/api/documents/${id}`, { fields }),
  confirmDocument: (id: string) => post(`/api/documents/${id}/confirm`),
  commentDocument: (id: string, body: string, internal = false) =>
    post<{
      comment: {
        id: string;
        body: string;
        internal: boolean;
        createdAt: string;
        author: { name: string; role: string };
      };
    }>(`/api/documents/${id}/comment`, { body, internal }),
  downloadLetter: (caseId: string) =>
    get<{
      letter: {
        id: string;
        fileName: string;
        version: number;
        createdAt: string;
      };
      download: string | null;
      note: string | null;
    }>(`/api/cases/${caseId}/letter`),
  letters: (caseId: string) =>
    get<{
      letters: Array<{
        id: string;
        fileName: string;
        type: string | null;
        ref: string | null;
        sizeBytes: number;
        createdAt: string;
      }>;
    }>(`/api/cases/${caseId}/letters`),
  generateLetter: (caseId: string, type: string) =>
    post<{
      letter: {
        id: string;
        fileName: string;
        type: string | null;
        ref: string | null;
        sizeBytes: number;
        createdAt: string;
        issuedBy: string;
      };
    }>(`/api/cases/${caseId}/letters`, { type }),
  downloadLetterById: (letterId: string) =>
    requestBlob(`/api/letters/${letterId}/download`),
  /** Original bytes of one uploaded document (auth-gated stream). */
  downloadDocumentById: (documentId: string) =>
    requestBlob(`/api/documents/${documentId}/content?variant=original`),
  messages: (caseId: string) =>
    get<{
      messages: Array<{
        id: string;
        body: string;
        createdAt: string;
        author: { name: string; role: string };
        attachment?: {
          id: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
        } | null;
      }>;
    }>(`/api/messages?caseId=${caseId}`),
  sendMessage: (caseId: string, body: string, documentId?: string) =>
    post<{
      message: {
        id: string;
        caseId: string;
        body: string;
        createdAt: string;
        author: { name: string; role: string };
        attachment?: {
          id: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
        } | null;
      };
    }>("/api/messages", {
      caseId,
      body,
      ...(documentId ? { documentId } : undefined),
    }),

  // peer-to-peer calling (WebRTC signaling relays through REST)
  callStart: (caseId: string, kind: "AUDIO" | "VIDEO") =>
    post<{ call: CallRow }>("/api/calls", { caseId, kind }),
  calls: (params?: { caseId?: string; active?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.caseId) sp.set("caseId", params.caseId);
    if (params?.active) sp.set("active", "1");
    const qs = sp.toString();
    return get<{ calls: CallRow[] }>(`/api/calls${qs ? `?${qs}` : ""}`);
  },
  callGet: (id: string) =>
    get<{
      call: CallRow;
      side: "CLIENT" | "STAFF";
      transcript: string;
      transcriptUpdatedAt: string | null;
      recordingRequested: boolean;
      consentComplete: boolean;
      consents: Array<{ byUserId: string; role: string; at: string }>;
    }>(`/api/calls/${id}`),
  callAction: (id: string, action: "answer" | "decline" | "end") =>
    post<{ call: CallRow }>(`/api/calls/${id}`, { action }),
  /** ICE servers resolved server-side (TURN credentials never reach the bundle). */
  iceServers: () =>
    get<{
      iceServers: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }>;
      ttl: number | null;
    }>("/api/calls/ice"),
  callSignals: (id: string, after: number) =>
    get<{
      status: string;
      signals: Array<{ seq: number; kind: string; payload: string }>;
    }>(`/api/calls/${id}/signals?after=${after}`),
  callSignal: (
    id: string,
    kind: "OFFER" | "ANSWER" | "ICE" | "HANGUP" | "SUBTITLE",
    payload: Record<string, unknown>,
  ) => post<{ seq: number }>(`/api/calls/${id}/signals`, { kind, payload }),
  /** Autosave the live transcript, set the recording-consent flag, and ack this side. Transcript stays hidden until BOTH sides ack. */
  callTranscriptSave: (
    id: string,
    p: {
      transcript?: string;
      recordingRequested?: boolean;
      consentGiven?: boolean;
    },
  ) =>
    patch<{
      transcript: string;
      transcriptUpdatedAt: string | null;
      recordingRequested: boolean;
      consentComplete: boolean;
      consents: Array<{ byUserId: string; role: string; at: string }>;
    }>(`/api/calls/${id}`, p),

  // internal staff teams (staff-only; CLIENT/AUDITOR are 403)
  teams: () => get<{ teams: TeamRow[] }>("/api/teams"),
  team: (id: string) =>
    get<{
      team: TeamRow;
      members: Array<{
        userId: string;
        name: string;
        email: string;
        role: string;
        teamRole: string;
        addedAt: string;
      }>;
    }>(`/api/teams/${id}`),
  createTeam: (p: {
    name: string;
    description?: string;
    kind?: string;
    memberIds?: string[];
  }) => post<{ team: TeamRow }>("/api/teams", p),
  updateTeam: (
    id: string,
    patchBody: {
      name?: string;
      description?: string;
      kind?: string;
      archived?: boolean;
    },
  ) => patch<{ team: TeamRow }>(`/api/teams/${id}`, patchBody),
  teamAction: (
    id: string,
    body: {
      action:
        | "add-member"
        | "remove-member"
        | "update-member"
        | "read"
        | "transcribe";
      userId?: string;
      role?: string;
      messageId?: string;
      transcript?: string;
    },
  ) =>
    post<{ ok?: boolean; message?: TeamMessageRow }>(
      `/api/teams/${id}/${body.action}`,
      body,
    ),
  teamMessages: (id: string, after?: string) =>
    get<{ messages: TeamMessageRow[]; readAt: string | null }>(
      `/api/teams/${id}/messages${
        after ? `?after=${encodeURIComponent(after)}` : ""
      }`,
    ),
  sendTeamMessage: (
    id: string,
    body: {
      body?: string;
      kind?: "TEXT" | "AUDIO";
      audioBase64?: string;
      audioMime?: string;
      audioDurationMs?: number;
      transcript?: string;
    },
  ) => post<{ message: TeamMessageRow }>(`/api/teams/${id}/messages`, body),
  /** Auth-gated voice-note stream — fetch the bytes, then play an object URL. */
  teamRecordingBlob: (id: string, messageId: string) =>
    requestBlob(`/api/teams/${id}/recordings/${messageId}`),

  // internal meetings (WebRTC mesh over REST signaling, server-capped at 4)
  meetingCreate: (p: {
    teamId?: string;
    caseId?: string;
    title?: string;
    kind?: "AUDIO" | "VIDEO";
  }) => post<{ meeting: MeetingRow }>("/api/meetings", p),
  meetings: (params?: {
    active?: boolean;
    teamId?: string;
    caseId?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params?.active) sp.set("active", "1");
    if (params?.teamId) sp.set("teamId", params.teamId);
    if (params?.caseId) sp.set("caseId", params.caseId);
    const qs = sp.toString();
    return get<{ meetings: MeetingRow[] }>(
      `/api/meetings${qs ? `?${qs}` : ""}`,
    );
  },
  meeting: (id: string) =>
    get<{
      meeting: MeetingRow;
      side: "HOST" | "MEMBER";
      consent: {
        consents: Array<{ byUserId: string; at: string }>;
        ackedByMe: boolean;
        missing: number;
      };
    }>(`/api/meetings/${id}`),
  meetingAction: (
    id: string,
    body: {
      action: "join" | "leave" | "end" | "state";
      micOn?: boolean;
      cameraOn?: boolean;
      reason?: string;
    },
  ) => post<{ meeting: MeetingRow }>(`/api/meetings/${id}`, body),
  meetingSignals: (id: string, after: number) =>
    get<{
      status: string;
      participants: MeetingRow["participants"];
      signals: Array<{
        seq: number;
        fromUserId: string;
        kind: string;
        payload: string;
      }>;
    }>(`/api/meetings/${id}/signals?after=${after}`),
  meetingSignal: (
    id: string,
    body: {
      toUserId: string | null;
      kind: "OFFER" | "ANSWER" | "ICE" | "HANGUP" | "STATE";
      payload: Record<string, unknown>;
    },
  ) => post<{ seq: number }>(`/api/meetings/${id}/signals`, body),
  meetingStoreRecording: (
    id: string,
    p: {
      audioBase64: string;
      mime: string;
      durationMs?: number;
      consentGiven: boolean;
    },
  ) => post<{ ok: boolean; bytes: number }>(`/api/meetings/${id}/recording`, p),
  meetingAckRecording: (id: string) =>
    post<{ seq: number }>(`/api/meetings/${id}/signals`, {
      toUserId: null,
      kind: "CONSENT",
      payload: {},
    }),
  meetingSaveTranscript: (id: string, transcript: string) =>
    patch<{ ok: boolean }>(`/api/meetings/${id}/recording`, { transcript }),
  /** Relative URL for an <audio src> — the stream is auth-gated server-side. */
  meetingRecordingUrl: (id: string) => `/api/meetings/${id}/recording`,

  // RM
  crm: (
    view: "contacts" | "tasks" | "activity",
    params?: { q?: string; status?: string },
  ) => {
    const sp = new URLSearchParams({ view });
    if (params?.q) sp.set("q", params.q);
    if (params?.status) sp.set("status", params.status);
    return get<{
      contacts?: Array<{
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        company: string | null;
        source: string;
        ownerId: string | null;
        createdAt: string;
        activities: Array<{
          id: string;
          kind: string;
          summary: string;
          createdAt: string;
        }>;
      }>;
      tasks?: Array<{
        id: string;
        title: string;
        notes: string;
        status: string;
        priority: string;
        dueDate: string | null;
        assigneeId: string | null;
        contactId: string | null;
        caseId: string | null;
        createdAt: string;
      }>;
      activity?: Array<{
        id: string;
        kind: string;
        summary: string;
        contactId: string | null;
        caseId: string | null;
        leadId: string | null;
        createdAt: string;
      }>;
    }>(`/api/crm?${sp.toString()}`);
  },
  crmWrite: (body: Record<string, unknown>) =>
    post<{ contact?: unknown; task?: unknown; ok?: boolean }>("/api/crm", body),
  // ── accounts (CRM⁺ Accounts module) ──
  accounts: (params?: { q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    const qs = sp.toString();
    return get<{ accounts: Array<Record<string, unknown>>; truncated?: boolean }>(
      `/api/accounts${qs ? `?${qs}` : ""}`,
    );
  },
  account: (id: string) => get<{ account: Record<string, unknown> }>(`/api/accounts/${id}`),
  createAccount: (body: Record<string, unknown>) =>
    post<{ account: Record<string, unknown> }>("/api/accounts", body),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    patch<{ account: Record<string, unknown> }>(`/api/accounts/${id}`, body),
  deleteAccount: (id: string) => del<{ ok: boolean }>(`/api/accounts/${id}`),
  // ── potentials (CRM⁺ Potentials module) ──
  potentials: (params?: { q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    const qs = sp.toString();
    return get<{ potentials: Array<Record<string, unknown>>; truncated?: boolean }>(
      `/api/potentials${qs ? `?${qs}` : ""}`,
    );
  },
  potential: (id: string) => get<{ potential: Record<string, unknown> }>(`/api/potentials/${id}`),
  createPotential: (body: Record<string, unknown>) =>
    post<{ potential: Record<string, unknown> }>(`/api/potentials`, body),
  updatePotential: (id: string, body: Record<string, unknown>) =>
    patch<{ potential: Record<string, unknown> }>(`/api/potentials/${id}`, body),
  deletePotential: (id: string) => del<{ ok: boolean }>(`/api/potentials/${id}`),
  // ── sales orders (CRM⁺ SalesOrder module) ──
  salesOrders: (params?: { q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    const qs = sp.toString();
    return get<{ salesOrders: Array<Record<string, unknown>>; truncated?: boolean }>(
      `/api/sales-orders${qs ? `?${qs}` : ""}`,
    );
  },
  salesOrder: (id: string) => get<{ salesOrder: Record<string, unknown> }>(`/api/sales-orders/${id}`),
  createSalesOrder: (body: Record<string, unknown>) =>
    post<{ salesOrder: Record<string, unknown> }>(`/api/sales-orders`, body),
  updateSalesOrder: (id: string, body: Record<string, unknown>) =>
    patch<{ salesOrder: Record<string, unknown> }>(`/api/sales-orders/${id}`, body),
  deleteSalesOrder: (id: string) => del<{ ok: boolean }>(`/api/sales-orders/${id}`),
  // ── products (CRM⁺ Products module) ──
  products: (params?: { q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    const qs = sp.toString();
    return get<{ products: Array<Record<string, unknown>>; truncated?: boolean }>(
      `/api/products${qs ? `?${qs}` : ""}`,
    );
  },
  product: (id: string) => get<{ product: Record<string, unknown> }>(`/api/products/${id}`),
  createProduct: (body: Record<string, unknown>) =>
    post<{ product: Record<string, unknown> }>(`/api/products`, body),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    patch<{ product: Record<string, unknown> }>(`/api/products/${id}`, body),
  deleteProduct: (id: string) => del<{ ok: boolean }>(`/api/products/${id}`),
  rmCases: (params?: {
    status?: string;
    q?: string;
    mine?: boolean;
    cursor?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.q) sp.set("q", params.q);
    if (params?.mine) sp.set("mine", "1");
    if (params?.cursor) sp.set("cursor", params.cursor);
    const qs = sp.toString();
    return get<{
      cases: Array<{
        id: string;
        reference: string;
        status: string;
        dataApproval: string | null;
        serviceApproval: string | null;
        riskFlag: string;
        client: {
          id: string;
          name: string;
          email: string;
          nationality: string | null;
        };
        programme: { name: string; country: string } | null;
        rm: string | null;
        documentsTotal: number;
        documentsApproved: number;
        openRequests: number;
        dispatch: { trackingId: string; status: string } | null;
        hasLetter: boolean;
        updatedAt: string;
        ageDays: number;
      }>;
      nextCursor: string | null;
    }>(`/api/rm/cases${qs ? `?${qs}` : ""}`);
  },
  approveData: (
    caseId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string,
  ) => post(`/api/cases/${caseId}/approve-data`, { decision, reason }),
  // triage — prioritised active-case queue (GET rescoring is org-scoped; POST
  // recalculates the whole queue under the `triage.run` capability)
  triage: () =>
    get<{
      queue: TriageScore[];
      counts: Record<TriageTier, number>;
      generatedAt: string;
      actor: string;
    }>("/api/triage"),
  triageRecalculate: () =>
    post<{ queue: TriageScore[]; recalculated: number }>("/api/triage", {}),
  triageCase: (caseId: string) =>
    get<TriageScore>(`/api/triage?caseId=${encodeURIComponent(caseId)}`),
  /** Senior-only countersignature — the second half of the two-person rule. */
  countersignData: (caseId: string, reason: string) =>
    post(`/api/cases/${caseId}/countersign-data`, { reason }),
  /** Send a rejected case back to the client for correction (un-wedges the review). */
  requestDataCorrection: (caseId: string, reason: string) =>
    post(`/api/cases/${caseId}/request-changes`, { reason }),
  approveService: (
    caseId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string,
  ) => post(`/api/cases/${caseId}/approve-service`, { decision, reason }),
  /** Edit the client's profile details on a case (RM/SENIOR_RM only). */
  editClient: (
    caseId: string,
    fields: {
      name?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
      nationality?: string;
      dateOfBirth?: string;
    },
  ) =>
    post<{ ok: boolean; updated: string[] }>(
      `/api/cases/${caseId}/edit-client`,
      fields,
    ),
  /** Senior-only countersignature — the second half of the two-person rule. */
  countersignService: (caseId: string, reason: string) =>
    post(`/api/cases/${caseId}/countersign-service`, { reason }),
  reviewDocument: (
    docId: string,
    decision: "APPROVED" | "REJECTED" | "REQUEST_CHANGES",
    reason: string,
  ) => post(`/api/documents/${docId}/review`, { decision, reason }),
  /** KYC/AML screening posture for a case (current results + outstanding + blocked). */
  screenings: (caseId: string) =>
    get<{
      checks: Array<{
        key: string;
        label: string;
        purpose: string;
        severity: string;
        required: boolean;
      }>;
      rows: Array<{
        id: string;
        checkKey: string;
        result: string;
        severity: string;
        note: string | null;
        providerRef: string | null;
        runByLabel: string | null;
        createdAt: string;
        supersededAt: string | null;
      }>;
      blocked: boolean;
      outstanding: string[];
    }>(`/api/screenings?caseId=${caseId}`),
  /** Record a screening outcome (staff, screening.run). */
  recordScreening: (
    caseId: string,
    p: {
      checkKey: string;
      result: "PASS" | "FAIL" | "REVIEW" | "UNKNOWN";
      note?: string;
      providerRef?: string;
    },
  ) => post(`/api/screenings`, { caseId, ...p }),
  /**
   * Watchlist match across name variants (staff, case.read.all). This is a
   * QUERY: it records nothing and decides nothing. It answers 503 — never an
   * empty list — when the matcher is unreachable, so a caller must render the
   * failure rather than treat it as "no hits".
   */
  matchScreenings: (p: {
    name: string;
    birthDate?: string;
    country?: string;
    dataset?: string;
    limit?: number;
  }) => post<ScreeningsMatch>("/api/screenings/match", p),
  createRequest: (
    caseId: string,
    p: {
      docType: string;
      title: string;
      instructions: string;
      dueInDays?: number;
    },
  ) => post(`/api/cases/${caseId}/requests`, p),
  markRequestNotNeeded: (requestId: string, reason: string) =>
    post<{ request: { id: string; status: string } }>(
      `/api/doc-requests/${requestId}/not-needed`,
      { reason },
    ),
  dispatch: (caseId: string, destination: string, documentIds: string[]) =>
    post<{ dispatch: { trackingId: string }; sandbox: boolean }>(
      `/api/cases/${caseId}/dispatch`,
      { destination, documentIds },
    ),
  scheduleFollowUp: (caseId: string, weeks: number) =>
    post(`/api/cases/${caseId}/followup`, { weeks }),
  uploadLetter: (caseId: string, fileName: string, dataBase64: string) =>
    post(`/api/cases/${caseId}/letter`, { fileName, dataBase64 }),
  timeline: (caseId: string) =>
    get<{
      history: CaseView["timeline"];
      comments: Array<{
        id: string;
        body: string;
        internal: boolean;
        createdAt: string;
        author: { name: string; role: string };
      }>;
    }>(`/api/cases/${caseId}/timeline`),
  evidenceReadiness: (caseId: string) =>
    get<{
      summary: import("@/lib/services/evidence-readiness").EvidenceReadinessSummary;
    }>(`/api/cases/${caseId}/evidence-readiness`),
  scoreHistory: (caseId: string) =>
    get<{
      latest: import("@/lib/ports/submission-readiness").PersistedScore | null;
      history: import("@/lib/ports/submission-readiness").PersistedScore[];
    }>(`/api/cases/${caseId}/submission-score`),
  recordScore: (
    caseId: string,
    p: {
      programmeKey?: string;
      documents?: import("@/lib/services/submission-readiness").ScoreDocEvidence[];
      screeningDone?: Array<string | null | undefined>;
      sofSubmitted?: boolean;
      sofHasEvidence?: boolean;
    },
  ) => post(`/api/cases/${caseId}/submission-score`, p),
  overrideScore: (
    caseId: string,
    p: { baseId: string; effectiveScore: number; note: string },
  ) =>
    post(`/api/cases/${caseId}/submission-score`, { action: "override", ...p }),
  adversarialReview: (caseId: string) =>
    get<{
      review: import("@/lib/services/adversarial-review").AdversarialReview;
    }>(`/api/cases/${caseId}/adversarial-review`),
  caseProgress: (caseId: string) =>
    get<{ progress: import("@/lib/services/case-progress").CaseProgress }>(
      `/api/cases/${caseId}/progress`,
    ),
  assignCase: (caseId: string, assigneeId: string) =>
    post(`/api/cases/${caseId}/assign`, { assigneeId }),
  completeCase: (caseId: string, reason?: string) =>
    post<{ ok: boolean; status: string }>(`/api/cases/${caseId}/complete`, {
      reason,
    }),
  cancelCase: (caseId: string, reason?: string) =>
    post<{ ok: boolean; status: string }>(`/api/cases/${caseId}/cancel`, {
      reason,
    }),

  // notifications
  notifications: (params?: { cursor?: string }) => {
    const sp = new URLSearchParams();
    if (params?.cursor) sp.set("cursor", params.cursor);
    const qs = sp.toString();
    return get<{
      notifications: Array<{
        id: string;
        title: string;
        body: string;
        category: string;
        status: string;
        readAt: string | null;
        caseId: string | null;
        createdAt: string;
      }>;
      nextCursor: string | null;
      unread: number;
      prefs: {
        inApp: boolean;
        email: boolean;
        push: boolean;
        quietHours?: string;
        categoryPrefs?: string | null;
        callPrefs?: string | null;
        chatPrefs?: string | null;
        locale?: string;
      } | null;
    }>(`/api/notifications${qs ? `?${qs}` : ""}`);
  },
  markRead: (id: string) => post("/api/notifications", { action: "read", id }),
  markAllRead: () => post("/api/notifications", { action: "readAll" }),
  savePrefs: (prefs: {
    inApp?: boolean;
    email?: boolean;
    push?: boolean;
    quietHours?: string;
    locale?: string;
    categoryPrefs?: Record<
      string,
      { inApp?: boolean; email?: boolean; push?: boolean }
    >;
    callPrefs?: {
      transcription?: boolean;
      recording?: boolean;
      defaultKind?: "AUDIO" | "VIDEO";
      subtitleLang?: string;
    };
    chatPrefs?: {
      voiceNotes?: boolean;
      autoPlayVoice?: boolean;
      captions?: boolean;
    };
  }) => post("/api/notifications", { action: "prefs", prefs }),

  // integrations (admin) — credentials stay server-side, masked on read
  integrations: () =>
    get<{
      integrations: Array<{
        key: string;
        kind: string;
        label: string;
        blurb: string;
        active: boolean;
        config: Record<string, unknown>;
        fields: Array<{
          key: string;
          label: string;
          type: string;
          options?: string[];
          required?: boolean;
          help?: string;
        }>;
        updatedAt: string | null;
        updatedBy: string | null;
      }>;
    }>("/api/settings/integrations"),
  saveIntegration: (
    key: string,
    config: Record<string, unknown>,
    active: boolean,
  ) => put(`/api/settings/integrations`, { key, config, active }),
  /** Live connectivity check against the STORED credentials (secrets never leave the server). */
  testIntegration: (key: string) =>
    post<{ ok: boolean; detail: string; checkedAt: string }>(
      "/api/settings/integrations/test",
      { key },
    ),
  /** The workflows-only n8n bundle (graphs, never credentials) — see /api/n8n/export. */
  n8nExport: (workflowKey?: string) =>
    get<{
      workflows: Array<{ name: string; nodes: unknown[] }>;
      counts: { workflows: number; nodes: number };
    }>(
      workflowKey
        ? `/api/n8n/export?workflow=${encodeURIComponent(workflowKey)}`
        : "/api/n8n/export",
    ),

  /** Get workflows from n8n instance */
  n8nWorkflows: () =>
    get<{
      workflows: Array<{
        id: string;
        name: string;
        active: boolean;
        nodeCount: number;
        updatedAt: string;
      }>;
    }>("/api/n8n/workflows"),

  /** Get details of a specific n8n workflow */
  n8nWorkflow: (id: string) =>
    get<{
      workflow: {
        id: string;
        name: string;
        active: boolean;
        nodeCount: number;
        updatedAt: string;
        nodes: Array<{ id: string; name: string; type: string }>;
        connections: Record<
          string,
          { main: Array<{ node: string; type: string; index: number }> }
        >;
      };
    }>(`/api/n8n/workflows/${encodeURIComponent(id)}`),

  /** Get executions from n8n instance */
  n8nExecutions: () =>
    get<{
      executions: Array<{
        id: string;
        workflowName: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
      }>;
    }>("/api/n8n/executions"),

  /** Get details of a specific n8n execution */
  n8nExecution: (id: string) =>
    get<{
      execution: {
        id: string;
        workflowName: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
        output: Record<string, unknown> | null;
        error: string | null;
      };
    }>(`/api/n8n/executions/${encodeURIComponent(id)}`),

  /** Test a workflow on n8n instance */
  n8nTestWorkflow: (workflowId: string, payload: Record<string, unknown>) =>
    post<{
      success: boolean;
      output?: Record<string, unknown>;
      error?: string;
    }>(`/api/n8n/workflows/${encodeURIComponent(workflowId)}/test`, payload),

  /** Toggle workflow active state on n8n instance */
  n8nToggleWorkflow: (workflowId: string, active: boolean) =>
    post<{ success: boolean; message: string }>(
      `/api/n8n/workflows/${encodeURIComponent(workflowId)}/toggle`,
      { active },
    ),

  /** Get workflow status from n8n instance */
  n8nWorkflowStatus: (workflowId: string) =>
    get<{
      status: {
        id: string;
        active: boolean;
        lastExecution: {
          id: string;
          status: string;
          startedAt: string;
          completedAt: string;
        } | null;
        nextScheduledRun: string | null;
        totalExecutions: number;
        successRate: number;
      };
    }>(`/api/n8n/workflows/${encodeURIComponent(workflowId)}/status`),

  /** Validate workflow configuration */
  n8nValidateWorkflow: (workflowId: string) =>
    post<{
      validation: {
        valid: boolean;
        errors: Array<{ code: string; message: string; nodeId?: string }>;
        warnings: Array<{ code: string; message: string; nodeId?: string }>;
        nodeCount: number;
        checkedAt: string;
      };
    }>(`/api/n8n/workflows/${encodeURIComponent(workflowId)}/validate`),

  /** Get execution history for a workflow */
  n8nWorkflowExecutions: (workflowId: string) =>
    get<{
      executions: Array<{
        id: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
        durationMs: number | null;
      }>;
    }>(`/api/n8n/workflows/${encodeURIComponent(workflowId)}/executions`),

  /** Stop a running execution */
  n8nStopExecution: (executionId: string) =>
    post<{ success: boolean; message: string; stoppedAt: string }>(
      `/api/n8n/executions/${encodeURIComponent(executionId)}/stop`,
    ),

  // webhooks (admin) — outbound signed webhook endpoints
  webhookEndpoints: () =>
    get<{ endpoints: WebhookEndpoint[] }>("/api/integrations/webhooks"),
  webhookDeliveries: () =>
    get<{ deliveries: WebhookDelivery[] }>(
      "/api/integrations/webhooks/deliveries",
    ),
  createWebhookEndpoint: (p: {
    url: string;
    description: string;
    events: string[];
    active?: boolean;
  }) =>
    post<{ endpoint: WebhookEndpoint; secret: string }>(
      "/api/integrations/webhooks",
      p,
    ),
  updateWebhookEndpoint: (
    id: string,
    p: {
      active?: boolean;
      url?: string;
      description?: string;
      events?: string[];
    },
  ) =>
    patch<{ endpoint: WebhookEndpoint }>(
      `/api/integrations/webhooks/${encodeURIComponent(id)}`,
      p,
    ),
  rotateWebhookSecret: (id: string) =>
    post<{ endpoint: WebhookEndpoint; secret: string }>(
      `/api/integrations/webhooks/${encodeURIComponent(id)}/rotate`,
      {},
    ),
  deleteWebhookEndpoint: (id: string) =>
    del<{ ok: boolean }>(
      `/api/integrations/webhooks/${encodeURIComponent(id)}`,
    ),
  testWebhookEndpoint: (id: string) =>
    post<{ delivered: boolean; delivery: WebhookDelivery }>(
      `/api/integrations/webhooks/${encodeURIComponent(id)}/test`,
      {},
    ),

  // brand & business (admin) — copy over canon defaults, deep-merged per section
  brand: () =>
    get<{ settings: CanonBrand & { updatedAt?: string } }>("/api/brand"),
  saveBrand: (patch: Partial<CanonBrand>) =>
    put<{ settings: CanonBrand & { updatedAt?: string } }>("/api/brand", patch),
  resetBrand: () =>
    post<{ settings: CanonBrand & { updatedAt?: string }; reset: boolean }>(
      "/api/brand/reset",
    ),
  businessSettings: () =>
    get<{ settings: BusinessConfig & { updatedAt?: string } }>(
      "/api/settings/business",
    ),
  saveBusinessSettings: (patch: Partial<BusinessConfig>) =>
    put<{ settings: BusinessConfig & { updatedAt?: string } }>(
      "/api/settings/business",
      patch,
    ),
  resetBusinessSettings: () =>
    post<{ settings: BusinessConfig & { updatedAt?: string }; reset: boolean }>(
      "/api/settings/business/reset",
    ),

  // platform settings (registry-driven) — only the sections the role may read
  platformSettings: () =>
    get<{ settings: Partial<PlatformSettings> }>("/api/settings"),
  saveSettingsSection: (section: string, patch: Record<string, unknown>) =>
    put<{ settings: PlatformSettings }>(`/api/settings/${section}`, patch),
  resetSettingsSection: (section: string) =>
    post<{ settings: PlatformSettings; reset: boolean }>(
      `/api/settings/${section}/reset`,
    ),
  manifest: () => get<Manifest>("/api/manifest"),

  // compliance & integration surface (staff only)
  complianceRopa: () => get<Ropa>("/api/compliance/ropa"),
  runRetention: (p: { dryRun?: boolean; reason: string }) =>
    post<RetentionRunResult>("/api/compliance/retention", p),
  openapi: () => get<Record<string, unknown>>("/api/openapi"),

  // push (VAPID)
  pushStatus: () =>
    get<{
      publicKey: string;
      subscribed: boolean;
      subscriptions: number;
      subject: string;
    }>("/api/push"),
  pushSubscribe: (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }) => post("/api/push", { action: "subscribe", subscription }),
  pushUnsubscribe: (endpoint: string) =>
    post("/api/push", { action: "unsubscribe", subscription: { endpoint } }),
  pushTest: () =>
    post<{
      sent: number;
      results: Array<{ endpoint: string; ok: boolean; error?: string }>;
    }>("/api/push", { action: "test" }),

  // admin
  adminStats: () =>
    get<{
      stats: Record<string, number>;
      casesByStatus: Array<{ status: string; count: number }>;
      workflows: Array<{
        id: string;
        name: string;
        status: string;
        currentVersion: number;
        disabled: boolean;
      }>;
      recentAudit: Array<{
        id: string;
        actorLabel: string;
        action: string;
        target: string;
        createdAt: string;
      }>;
    }>("/api/admin/stats"),
  adminUsers: () =>
    get<{
      users: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        status: string;
        profileState: string;
        nationality: string | null;
        lastLoginAt: string | null;
        _count: { clientCases: number; sessions: number };
      }>;
    }>("/api/admin/users"),
  /** Rebuild the sandbox demo dataset from the canonical seed definitions. */
  resetDemoData: () =>
    post<{
      ok: boolean;
      counts: {
        users: number;
        cases: number;
        documents: number;
        requests: number;
        notifications: number;
        auditEvents: number;
      };
    }>("/api/admin/demo/reset"),
  inviteUser: (p: {
    email: string;
    name: string;
    role: string;
    reason: string;
  }) =>
    post<{ user: { id: string; email: string }; tempPassword: string }>(
      "/api/admin/users",
      p,
    ),
  updateUser: (p: {
    id: string;
    role?: string;
    status?: string;
    reason: string;
  }) => post("/api/admin/users-update", p),
  revokeSessions: (id: string, reason: string) =>
    post<{ revoked: number }>("/api/admin/revoke-sessions", { id, reason }),
  audit: (params?: { action?: string; actor?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.action) sp.set("action", params.action);
    if (params?.actor) sp.set("actor", params.actor);
    if (params?.page) sp.set("page", String(params.page));
    const qs = sp.toString();
    return get<{
      events: Array<{
        id: string;
        actorLabel: string;
        action: string;
        target: string;
        before: string | null;
        after: string | null;
        reason: string | null;
        createdAt: string;
      }>;
      total: number;
      page: number;
    }>(`/api/admin/audit${qs ? `?${qs}` : ""}`);
  },
  auditExport: () =>
    fetch("/api/admin/audit?export=csv", {
      credentials: "same-origin",
      headers: bearerToken
        ? { authorization: `Bearer ${bearerToken}` }
        : undefined,
    }).then((r) => r.text()),
  reportExport: (report: "cases" | "rm-load" | "funnel" | "programmes") =>
    fetch(`/api/admin/reports/export?report=${report}`, {
      credentials: "same-origin",
      headers: bearerToken
        ? { authorization: `Bearer ${bearerToken}` }
        : undefined,
    }).then((r) => {
      if (!r.ok) throw new Error(`Report export failed (HTTP ${r.status})`);
      return r.text();
    }),
  // Operations watchlist — stale cases, due reminders and letters awaiting
  // approval. Both endpoints existed server-side with no caller.
  opsAlerts: () =>
    get<{
      staleCases: Array<{
        id: string;
        reference: string;
        status: string;
        updatedAt: string;
      }>;
      dueReminders: Array<{
        id: string;
        title: string;
        dueAt: string;
        status: string;
      }>;
      openLetters: Array<{ id: string; caseId: string; createdAt: string }>;
      generatedAt: string;
    }>("/api/ops/alerts"),
  opsAuditIntegrity: () =>
    get<{
      windowDays: number;
      total: number;
      systemRows: number;
      uncorrelated: number;
      ok: boolean;
      generatedAt: string;
    }>("/api/ops/audit-integrity"),

  // Records — the three ledgers that had working endpoints and no screen.
  finance: () =>
    get<{
      invoices: Array<{
        id: string;
        number: string;
        orgId: string;
        clientId: string;
        caseId: string | null;
        title: string;
        currency: string;
        amountCents: number;
        status: string;
        notes: string | null;
        lineItems: string | null;
        issuedAt: string | null;
        dueAt: string | null;
        paidAt: string | null;
        primaryBy: string | null;
        approvedBy: string | null;
        approvedAt: string | null;
        createdAt: string;
        updatedAt: string;
        payments: Array<{
          amountCents: number;
          method: string;
          receivedAt: string;
          reference: string | null;
        }>;
        creditNotes: Array<{
          amountCents: number;
          reason: string | null;
          createdAt: string;
        }>;
      }>;
      summary: { count: number; paidCents: number; openCents: number };
    }>("/api/finance"),
  createInvoice: (p: {
    clientId: string;
    caseId?: string;
    title: string;
    amountCents: number;
    currency?: string;
    dueDays?: number;
    notes?: string;
  }) => post<{ invoice: { id: string; number: string } }>("/api/finance", p),
  /** Invoice close-out actions — the server only accepts these exact codes. */
  financeAction: (
    id: string,
    action: "APPROVE" | "PAY" | "VOID" | "CREDIT_NOTE",
    body?: { method?: string; reference?: string; amountCents?: number; reason?: string },
  ) =>
    patch<{ invoice: { id: string; status: string } }>(
      `/api/finance/${encodeURIComponent(id)}`,
      { action, ...body },
    ),

  // ── bookings (consultation slots) ──
  bookings: () =>
    get<{
      bookings: Array<{
        id: string;
        slotId: string;
        startsAt: string;
        durationMin: number;
        status: string;
        cancelReason: string | null;
        clientName: string;
        clientEmail: string;
        clientId: string | null;
        caseId: string | null;
        channel: string;
        note: string | null;
        createdAt: string;
        case: { id: string; reference: string } | null;
      }>;
      nextCursor?: string;
    }>("/api/bookings?mine=1"),
  bookingAction: (
    id: string,
    action: "CONFIRM" | "CANCEL" | "NO_SHOW",
    reason?: string,
  ) =>
    post<{ ok: boolean; status: string }>(
      `/api/bookings/${encodeURIComponent(id)}`,
      { action, reason },
    ),

  // ── consultations ──
  consultations: () =>
    get<{
      consultations: Array<{
        id: string;
        orgId: string;
        leadName: string;
        leadEmail: string;
        leadPhone: string | null;
        programmeKey: string | null;
        scheduledAt: string;
        durationMin: number;
        status: string;
        icsSentAt: string | null;
        notes: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
    }>("/api/consultations"),

  // ── reminders ──
  reminders: () =>
    get<{
      reminders: Array<{
        id: string;
        caseId: string | null;
        clientId: string | null;
        kind: string;
        title: string;
        detail: string | null;
        dueAt: string;
        status: string;
        audience: string;
        dedupeKey: string;
        firedAt: string | null;
        escalatedAt: string | null;
        createdAt: string;
        case: { id: string; reference: string; clientId: string } | null;
      }>;
      lastSweep: string | null;
    }>("/api/reminders"),
  reminderSweep: () =>
    post<{ swept: { fired: number; escalated: number } }>("/api/reminders", {
      action: "sweep",
    }),

  renewals: () =>
    get<{
      renewals: Array<{
        id: string;
        caseId: string | null;
        clientId: string;
        kind: string;
        title: string;
        notes: string | null;
        dueAt: string;
        remindAt: string | null;
        status: string;
        orgId: string;
        createdAt: string;
        updatedAt: string;
        case: { reference: string; clientId: string } | null;
      }>;
    }>("/api/renewals"),
  renewalUpdate: (
    id: string,
    p: { status?: string; dueAt?: string; notes?: string },
  ) =>
    patch<{ renewal: { id: string; status: string } }>(
      `/api/renewals/${encodeURIComponent(id)}`,
      p,
    ),
  createRenewal: (p: {
    caseId?: string;
    kind?: string;
    title: string;
    dueAt: string;
    remindInDays?: number;
    notes?: string;
  }) => post<{ renewal: { id: string; title: string } }>("/api/renewals", p),
  privacyRequests: () =>
    get<{
      requests: Array<{
        id: string;
        userId: string;
        kind: string;
        detail: string;
        status: string;
        createdAt: string;
      }>;
    }>("/api/privacy/requests?all=1"),
  triagePrivacyRequest: (id: string, status: string) =>
    patch<{ request: { id: string; status: string } }>(
      "/api/privacy/requests",
      { id, status },
    ),
  pieces: () =>
    get<{
      pieces: Array<{
        id: string;
        key: string;
        name: string;
        category: string;
        description: string;
        icon: string;
        dataClass: string;
        authReq: string;
        enabled: boolean;
        docsUrl: string | null;
      }>;
    }>("/api/admin/pieces"),
  togglePiece: (key: string, enabled: boolean, reason?: string) =>
    post("/api/admin/pieces", { key, enabled, reason }),
  connections: () =>
    get<{
      connections: Array<{
        id: string;
        pieceKey: string;
        name: string;
        scopes: string;
        maskedHint: string;
        owner: string;
        status: string;
        lastUsedAt: string | null;
        expiresAt: string | null;
      }>;
    }>("/api/admin/connections"),
  rotateConnection: (id: string) => post("/api/admin/connections", { id }),
  notificationLogs: () =>
    get<{
      logs: Array<{
        id: string;
        title: string;
        body: string;
        channel: string;
        status: string;
        createdAt: string;
        user: { name: string; email: string; role: string };
      }>;
      dlq: Array<{
        id: string;
        topic: string;
        status: string;
        createdAt: string;
      }>;
      queued: number;
    }>("/api/admin/notifications"),
  retryNotification: (id: string) =>
    post("/api/admin/notifications", { action: "retry", id }),
  flags: () =>
    get<{ flags: Array<{ key: string; name: string; enabled: boolean }> }>(
      "/api/admin/flags",
    ),
  toggleFlag: (key: string, enabled: boolean) =>
    post("/api/admin/flags", { key, enabled }),
  // flags (extended) — create a new flag or rename an existing one (carries a reason)
  saveFlag: (p: {
    key: string;
    name?: string;
    enabled: boolean;
    reason?: string;
  }) =>
    post<{ flag: { key: string; name: string; enabled: boolean } }>(
      "/api/admin/flags",
      p,
    ),
  // programmes (services) — ADMIN-authored catalogue CRUD
  adminProgrammes: () =>
    get<{ programmes: AdminProgramme[] }>("/api/admin/programmes"),
  createProgramme: (p: {
    key: string;
    name: string;
    country: string;
    description: string;
    active?: boolean;
    reason: string;
  }) => post<{ programme: AdminProgramme }>("/api/admin/programmes", p),
  updateProgramme: (p: {
    id: string;
    name?: string;
    country?: string;
    description?: string;
    active?: boolean;
    reason: string;
  }) => post<{ programme: AdminProgramme }>("/api/admin/programmes-update", p),
  // message templates — ADMIN-authored notification copy with {{token}} interpolation
  templates: () => get<{ templates: MessageTemplate[] }>("/api/templates"),
  saveTemplate: (p: {
    key: string;
    name: string;
    channel?: string;
    subject?: string;
    body: string;
    locale?: string;
    active?: boolean;
  }) => post<{ template: MessageTemplate }>("/api/templates", p),
  deleteTemplate: (id: string) =>
    del<{ ok: boolean }>(`/api/templates?id=${encodeURIComponent(id)}`),
  telemetry: (params?: { kind?: string; take?: number }) => {
    const sp = new URLSearchParams();
    if (params?.kind) sp.set("kind", params.kind);
    if (params?.take) sp.set("take", String(params.take));
    const qs = sp.toString();
    return get<{
      events: Array<{
        id: string;
        kind: string;
        name: string;
        view: string | null;
        path: string | null;
        role: string | null;
        status: number | null;
        durationMs: number | null;
        createdAt: string;
      }>;
      counts: Array<{ kind: string; count: number }>;
    }>(`/api/telemetry${qs ? `?${qs}` : ""}`);
  },
  pruneTelemetry: () => get<{ pruned: number }>("/api/telemetry?prune=1"),

  // news-scan (regulatory watch)
  newsScan: () =>
    get<{
      profiles: Array<{
        id: string;
        label: string;
        sources: unknown;
        keywords: unknown;
        checkEveryHours: number;
        active: boolean;
        lastRunAt: string | null;
        createdAt: string;
      }>;
      findings: Array<{
        id: string;
        profileId: string;
        sourceUrl: string;
        sourceLabel: string | null;
        contentHash: string;
        previousHash: string | null;
        proposal: unknown;
        excerpt: string;
        evidenceUrl: string;
        confidence: number;
        status: string;
        diff: unknown;
        importance: string;
        corroboratedBy: string | null;
        decidedBy: string | null;
        decidedAt: string | null;
        decisionReason: string | null;
        createdAt: string;
      }>;
    }>("/api/admin/news-scan"),
  newsScanRun: (profileId: string) =>
    post<{ result: { scanned: number; changed: number; findings: string[] } }>(
      "/api/admin/news-scan",
      { action: "run", profileId },
    ),
  newsScanCorroborate: (findingId: string, sourceUrl: string) =>
    post<{ result: unknown }>("/api/admin/news-scan", {
      action: "corroborate",
      findingId,
      sourceUrl,
    }),
  newsScanApprove: (findingId: string, reason: string) =>
    post<{ result: unknown }>("/api/admin/news-scan", {
      action: "approve",
      findingId,
      reason,
    }),
  newsScanDismiss: (findingId: string, reason: string) =>
    post<{ result: unknown }>("/api/admin/news-scan", {
      action: "dismiss",
      findingId,
      reason,
    }),

  // automation (in-app engine)
  automationStatus: () =>
    get<{
      engine?: { mode: string };
      queue?: AutomationQueueStats;
      dead?: AutomationDeadJob[];
      health: {
        online: boolean;
        detail: string;
        pendingJobs: number;
        recentDeliveries: number;
      };
      recent: Array<{
        id: string;
        topic: string;
        status: string;
        attempts: number;
        correlationId: string | null;
        createdAt: string;
        detail: string | null;
        caseId: string | null;
      }>;
      viewer: string;
      alerts?: AutomationAlert[];
    }>("/api/automation"),

  // AI block refinement (page builder inspector)
  aiRefineBlock: (
    block: { key?: string; type: string; config: Record<string, unknown> },
    instruction: string,
  ) =>
    post<{
      block: { key?: string; type: string; config: Record<string, unknown> };
      provider: string;
      changed: boolean;
      note?: string;
    }>("/api/ai/refine-block", { block, instruction }),
  automationPing: () =>
    post<{
      result: { delivered: boolean; detail: string };
      health: {
        online: boolean;
        version: string | null;
        webhookUrl: string;
        detail: string;
      };
      recent: Array<{
        id: string;
        topic: string;
        status: string;
        attempts: number;
        correlationId: string | null;
        createdAt: string;
        detail: string | null;
        caseId: string | null;
      }>;
    }>("/api/automation", { topic: "ping" }),
  automationRequeue: (id: string) =>
    post<{
      ok: boolean;
      queue: AutomationQueueStats;
      dead: AutomationDeadJob[];
    }>("/api/automation", { action: "requeue", id }),
  automationAcknowledgeAlert: (alertId: string) =>
    post<{ ok: boolean }>("/api/automation/alerts", {
      action: "acknowledge",
      alertId,
    }),
  automationJobs: (params?: { status?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return get<{
      jobs: Array<{
        id: string;
        topic: string;
        status: string;
        attempts: number;
        maxAttempts: number;
        lastError: string | null;
        correlationId: string | null;
        createdAt: string;
        finishedAt: string | null;
        claimedAt: string | null;
        claimedBy: string | null;
        notBefore: string;
        leaseUntil: string | null;
        concurrencyKey: string | null;
        workerClass: string | null;
        failureCategory: string | null;
      }>;
    }>(`/api/automation/jobs${qs ? `?${qs}` : ""}`);
  },
  automationJob: (id: string) =>
    get<{
      job: {
        id: string;
        topic: string;
        payload: string;
        status: string;
        attempts: number;
        maxAttempts: number;
        lastError: string | null;
        correlationId: string | null;
        createdAt: string;
        finishedAt: string | null;
        claimedAt: string | null;
        claimedBy: string | null;
        notBefore: string;
        orgId: string | null;
        leaseUntil: string | null;
        concurrencyKey: string | null;
        workerClass: string | null;
        failureCategory: string | null;
      };
      timeline: Array<{ at: string; event: string; detail?: string }>;
      attempts: Array<{
        id: string;
        attempt: number;
        workerId: string | null;
        status: string;
        failureCategory: string | null;
        error: string | null;
        startedAt: string;
        finishedAt: string | null;
        durationMs: number | null;
      }>;
    }>(`/api/automation/jobs/${encodeURIComponent(id)}`),

  // workflows
  workflows: () =>
    get<{
      workflows: Array<{
        id: string;
        name: string;
        description: string;
        status: string;
        currentVersion: number;
        disabled: boolean;
        owner: string;
        runs: number;
        updatedAt: string;
        versions: Array<{
          version: number;
          changelog: string;
          publishedAt: string | null;
          nodes: WfNode[];
          edges: WfEdge[];
        }>;
      }>;
      templates: Array<{
        key: string;
        name: string;
        category: string;
        description: string;
        pieces: string[];
        duration: string;
        risk: string;
      }>;
    }>("/api/workflows"),
  workflow: (id: string) =>
    get<{
      workflow: {
        id: string;
        name: string;
        description: string;
        status: string;
        currentVersion: number;
        disabled: boolean;
        owner: { name: string };
        runs: Array<{
          id: string;
          status: string;
          trigger: string;
          createdAt: string;
          startedAt: string;
          case: { reference: string } | null;
          nodeRuns: Array<{
            id: string;
            nodeKey: string;
            pieceKey: string;
            name: string;
            status: string;
            error: string | null;
            approvalDecision: string | null;
            startedAt: string | null;
            finishedAt: string | null;
          }>;
        }>;
        versions: Array<{
          version: number;
          changelog: string;
          publishedAt: string | null;
          nodes: WfNode[];
          edges: WfEdge[];
        }>;
      };
    }>(`/api/workflows/${id}`),
  createWorkflow: (name: string, description: string, templateKey?: string) =>
    post<{ workflow: { id: string }; seeded: boolean }>("/api/workflows", {
      name,
      description,
      templateKey,
    }),
  testRunWorkflow: (id: string) =>
    post<{ runId: string }>(`/api/workflows/${id}/test-run`, {}),
  saveDraft: (id: string, nodes: WfNode[], edges: WfEdge[]) =>
    put<{
      draftVersion: number;
      validation: { ok: boolean; errors: string[] };
    }>(`/api/workflows/${id}`, { nodes, edges }),
  validateWorkflow: (nodes: WfNode[], edges: WfEdge[]) =>
    post<{ ok: boolean; errors: string[] }>("/api/workflows", {
      action: "validate",
      nodes,
      edges,
    }),
  publishWorkflow: (id: string, changelog: string) =>
    post<{ published: number }>(`/api/workflows/${id}/publish`, { changelog }),
  rollbackWorkflow: (id: string, toVersion: number) =>
    post(`/api/workflows/${id}/rollback`, { toVersion }),
  duplicateWorkflow: (id: string) =>
    post<{ workflow: { id: string; name: string } }>(
      `/api/workflows/${id}/duplicate`,
      {},
    ),
  selfBuildWorkflow: (goal: string, name?: string) =>
    post<{
      workflow: { id: string; name: string };
      via: "direct";
      provider: string;
      validation: { ok: boolean; errors: string[] };
    }>("/api/selfbuild/workflow", { goal, name }),
  selfBuildPage: (brief: string, title?: string) =>
    post<{
      page: { id: string; title: string; slug: string };
      via: "direct";
      provider: string;
    }>("/api/selfbuild/page", { brief, title }),
  publicPages: () =>
    get<{
      pages: Array<{
        id: string;
        title: string;
        slug: string;
        version: number;
        publishedAt: string | null;
        updatedAt: string;
        hero: { headline?: string; subline?: string };
      }>;
    }>("/api/pages/public"),
  publicPage: (slug: string) =>
    get<{
      page: {
        id: string;
        title: string;
        slug: string;
        version: number;
        publishedAt: string | null;
        updatedAt: string;
        blocks: LaneBlock[];
        forms: Array<{ formKey: string; bound: boolean }>;
      };
    }>(`/api/pages/public/${encodeURIComponent(slug)}`),
  /** PUBLIC programme catalogue — marketing-safe, indicative by contract. */
  catalog: () =>
    get<{
      indicative: boolean;
      note: string;
      programmes: Array<{
        // The route projects the DB row's `name`/`description` onto the public
        // card contract's `label`/`summary` (the names the card and the
        // "programme of interest" select both read), and retains `name`/
        // `description` for callers that prefer them.
        key: string;
        label: string;
        name: string;
        summary: string;
        description: string;
        country: string;
        family: string;
        kind: "RESIDENCE" | "CITIZENSHIP";
        authority: string;
        feeChf: number;
        processingWeeks: number;
        minInvestment: number;
        currency: string;
        reviewedOn: string;
      }>;
      families: { CITIZENSHIP: number; RESIDENCE: number };
    }>("/api/catalog"),
  /** PUBLIC single-programme detail — with its indicative document checklist. */
  catalogProgramme: (key: string) =>
    get<{
      indicative: boolean;
      programme: {
        key: string;
        name: string;
        country: string;
        description: string;
        family: "EU_CITIZENSHIP" | "EU_RESIDENCE";
        authority?: string;
        feeChf?: number;
        processingWeeks?: number;
        minInvestment?: number;
        currency?: string;
        legalBasis?: string;
        checklist: Array<{
          label: string;
          issuedBy: string;
          certified: boolean;
          validityMonths: number | null;
        }>;
        watchFactors: string[];
      } | null;
    }>(`/api/catalog?key=${encodeURIComponent(key)}`),
  /** PUBLIC consultation request from the landing page. */
  submitEnquiry: (input: {
    name: string;
    email: string;
    phone?: string;
    country?: string;
    programmeKey?: string;
    budget?: number;
    message?: string;
  }) => post<{ received: boolean; reference: string }>("/api/enquiries", input),

  // eligibility pre-scan — indicative screening against the programme catalogue
  prescan: (input: {
    programmeKey?: string;
    caseId?: string;
    answers: PrescanAnswers;
  }) => post<PrescanResponse>("/api/prescan", input),

  // source-of-funds questionnaire — the client's own regulated declaration
  sof: (caseId: string) =>
    get<{ caseId: string; reference: string; sof: SofSubmission | null }>(
      `/api/cases/${caseId}/sof`,
    ),
  submitSof: (
    caseId: string,
    input: {
      sourceCategory: SofSourceCategory;
      description: string;
      estimatedAmountChf?: number;
      evidenceLinks?: string[];
      declaration: true;
    },
  ) =>
    post<{ received: boolean; caseId: string; sof: SofSubmission }>(
      `/api/cases/${caseId}/sof`,
      input,
    ),
  setWorkflowDisabled: (id: string, disabled: boolean, reason?: string) =>
    patch(`/api/workflows/${id}`, { disabled, reason }),

  // autopilot — automation auto-detection & auto-generation of inbound hooks
  autopilot: () => get<AutopilotSnapshot>("/api/autopilot"),
  autopilotScan: () =>
    post<{
      resources: AutopilotResource[];
      plan: AutopilotPlanItem[];
      summary: { exposable: number; toCreate: number; toRepair: number };
    }>("/api/autopilot", { action: "scan" }),
  autopilotProvision: () =>
    post<AutopilotProvisionResult>("/api/autopilot", { action: "provision" }),
  autopilotRotate: (id: string) =>
    post<{ endpoint: AutopilotEndpoint; secret: string }>("/api/autopilot", {
      action: "rotate",
      id,
    }),
  autopilotToggle: (id: string, active: boolean) =>
    post<{ endpoint: AutopilotEndpoint }>("/api/autopilot", {
      action: "toggle",
      id,
      active,
    }),
  autopilotDelete: (id: string) =>
    post<{ ok: boolean }>("/api/autopilot", { action: "delete", id }),
  testNode: (pieceKey: string, sampleInput: Record<string, unknown>) =>
    post<{ ok: boolean; output?: Record<string, unknown>; error?: string }>(
      "/api/workflows",
      { action: "test-node", pieceKey, sampleInput },
    ),
  pieces2: () =>
    get<{
      pieces: Array<{
        key: string;
        name: string;
        category: string;
        description: string;
        icon: string;
        dataClass: string;
        authReq: string;
      }>;
    }>("/api/admin/pieces"),

  // runs
  runs: (params?: { workflowId?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.workflowId) sp.set("workflowId", params.workflowId);
    if (params?.status) sp.set("status", params.status);
    const qs = sp.toString();
    return get<{
      runs: Array<{
        id: string;
        status: string;
        trigger: string;
        version: number;
        createdAt: string;
        startedAt: string;
        finishedAt: string | null;
        error: string | null;
        workflow: { name: string };
        case: { reference: string } | null;
      }>;
    }>(`/api/runs${qs ? `?${qs}` : ""}`);
  },
  run: (id: string) =>
    get<{
      run: {
        id: string;
        status: string;
        trigger: string;
        version: number;
        context: string;
        error: string | null;
        createdAt: string;
        startedAt: string;
        finishedAt: string | null;
        workflow: { name: string };
        case: { reference: string; id: string } | null;
        nodeRuns: Array<{
          id: string;
          nodeKey: string;
          pieceKey: string;
          name: string;
          status: string;
          inputPreview: string;
          outputPreview: string;
          error: string | null;
          approvalDecision: string | null;
          startedAt: string | null;
          finishedAt: string | null;
        }>;
      };
    }>(`/api/runs/${id}`),
  approveRun: (
    runId: string,
    nodeRunId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string,
  ) => post(`/api/runs/${runId}/approve`, { nodeRunId, decision, reason }),
  retryRun: (runId: string) =>
    post<{ runId: string }>(`/api/runs/${runId}/retry`, {}),
  cancelRun: (runId: string, reason?: string) =>
    post(`/api/runs/${runId}/cancel`, { reason }),

  // lane pages
  pages: () =>
    get<{
      pages: Array<{
        id: string;
        title: string;
        slug: string;
        status: string;
        version: number;
        owner: string;
        submissions: number;
        publishedAt: string | null;
        updatedAt: string;
        blocks: LaneBlock[];
        bindings: LaneBinding[];
      }>;
    }>("/api/pages"),
  page: (id: string, withSubmissions?: boolean) =>
    get<{
      page: {
        id: string;
        title: string;
        slug: string;
        status: string;
        version: number;
        blocks: LaneBlock[];
        bindings: LaneBinding[];
        owner: { name: string };
      };
      submissions?: Array<{
        id: string;
        data: string;
        runId: string | null;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/pages/${id}${withSubmissions ? "?withSubmissions=1" : ""}`),
  createPage: (title: string) =>
    post<{ page: { id: string; slug: string } }>("/api/pages", { title }),
  savePage: (id: string, blocks: LaneBlock[], bindings: LaneBinding[]) =>
    put(`/api/pages/${id}`, { blocks, bindings }),
  publishPage: (id: string) =>
    post<{ status: string; version: number }>(`/api/pages/${id}/publish`, {}),
  unpublishPage: (id: string) => post(`/api/pages/${id}/unpublish`, {}),
  submitPage: (id: string, data: Record<string, string>, formKey?: string) =>
    post<{ submissionId: string; runId: string | null; correlated: boolean }>(
      `/api/pages/${id}/submit`,
      { data, formKey },
    ),
  pageSubmissions: (id: string) =>
    get<{
      submissions: Array<{
        id: string;
        data: string;
        runId: string | null;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/pages/${id}/submissions`),

  // ai — grounded agents + auto-research
  aiAgent: (p: {
    agent: string;
    message?: string;
    caseId?: string;
    threadId?: string;
  }) =>
    post<{
      agent: string;
      reply: string;
      provider: string;
      contextUsed: string[];
      threadId: string;
      authority: "server";
      citations: Array<{
        factId: string;
        entity: string;
        field: string;
        value: string | null;
        source: { kind: string; ref: string; label: string };
      }>;
      confidence: number;
      runId: string;
    }>("/api/ai/agent", p),
  aiFeedback: (p: {
    agent: string;
    caseId?: string;
    threadId?: string;
    runId: string;
    rating: "HELPFUL" | "NOT_HELPFUL";
    comment?: string;
  }) => post<{ ok: boolean }>("/api/ai/feedback", p),
  aiResearch: () =>
    get<{
      generatedAt: string;
      summary: string;
      provider: string;
      insights: Array<{
        id: string;
        severity: string;
        title: string;
        detail: string;
        action?: string;
        count: number;
      }>;
    }>("/api/ai/research"),
  aiThreads: () =>
    get<{
      threads: Array<{
        id: string;
        scope: string;
        title: string;
        updatedAt: string;
      }>;
    }>("/api/ai/context"),
  aiThread: (id: string) =>
    get<{
      thread: {
        id: string;
        scope: string;
        messages: Array<{ role: string; content: string; at: string }>;
      } | null;
    }>(`/api/ai/context?id=${encodeURIComponent(id)}`),
  aiDeleteThread: (id: string) =>
    del<{ deleted: boolean }>(`/api/ai/context?id=${encodeURIComponent(id)}`),

  // reconciliation (Zenith blueprint §9)
  reconciliationRuns: () =>
    get<{
      runs: Array<{
        id: string;
        type: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
        totalCount: number;
        matchCount: number;
        mismatchCount: number;
        error: string | null;
      }>;
    }>("/api/reconciliation/runs"),
  reconciliationRun: (id: string) =>
    get<{
      run: {
        id: string;
        type: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
        totalCount: number;
        matchCount: number;
        mismatchCount: number;
        error: string | null;
      };
    }>(`/api/reconciliation/runs/${id}`),
  reconciliationFindings: (runId: string) =>
    get<{
      findings: Array<{
        id: string;
        entityType: string;
        entityId: string;
        field: string | null;
        expected: string | null;
        actual: string | null;
        severity: string;
        status: string;
      }>;
    }>(`/api/reconciliation/runs/${runId}/findings`),
  startReconciliation: (type: string) =>
    post<{ run: { id: string; type: string; status: string } }>(
      "/api/reconciliation/runs",
      { type },
    ),

  // incidents (Zenith blueprint §9)
  incidents: () =>
    get<{
      incidents: Array<{
        id: string;
        title: string;
        description: string;
        severity: string;
        status: string;
        assignedTo: string | null;
        createdAt: string;
        resolvedAt: string | null;
      }>;
    }>("/api/incidents"),
  createIncident: (p: {
    title: string;
    description?: string;
    severity?: string;
  }) =>
    post<{ incident: { id: string; title: string; status: string } }>(
      "/api/incidents",
      p,
    ),
  resolveIncident: (id: string, resolution: string) =>
    post<{ incident: { id: string; status: string } }>(
      `/api/incidents/${id}/resolve`,
      { resolution },
    ),

  // SLA clocks (Zenith blueprint §9)
  slaClocks: () =>
    get<{
      clocks: Array<{
        id: string;
        name: string;
        targetHours: number;
        startedAt: string;
        deadlineAt: string;
        status: string;
        caseId: string | null;
      }>;
    }>("/api/sla/clocks"),
  createSLAClock: (p: { caseId?: string; name: string; targetHours: number }) =>
    post<{ clock: { id: string; name: string; status: string } }>(
      "/api/sla/clocks",
      p,
    ),
  markSLAMet: (id: string) =>
    post<{ clock: { id: string; status: string } }>(
      `/api/sla/clocks/${id}/met`,
      {},
    ),
  pauseSLAClock: (id: string, reason: string) =>
    post<{ clock: { id: string; status: string } }>(
      `/api/sla/clocks/${id}/pause`,
      { reason },
    ),
  resumeSLAClock: (id: string) =>
    post<{ clock: { id: string; status: string } }>(
      `/api/sla/clocks/${id}/resume`,
      {},
    ),

  // ── parties ──
  listParties: (qs?: Record<string, string>) =>
    get<{
      parties: Array<{
        id: string;
        caseId: string;
        type: string;
        name: string;
        role: string;
        createdAt: string;
      }>;
    }>(`/api/parties${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getParty: (id: string) =>
    get<{
      party: {
        id: string;
        caseId: string;
        type: string;
        name: string;
        role: string;
        createdAt: string;
      };
    }>(`/api/parties/${id}`),
  createParty: (p: {
    caseId: string;
    type: string;
    name: string;
    role: string;
  }) =>
    post<{
      party: {
        id: string;
        caseId: string;
        type: string;
        name: string;
        role: string;
      };
    }>("/api/parties", p),
  updateParty: (id: string, p: { name?: string; role?: string }) =>
    patch<{ party: { id: string; name: string; role: string } }>(
      `/api/parties/${id}`,
      p,
    ),

  // ── duplicates ──
  listDuplicates: (qs?: Record<string, string>) =>
    get<{
      duplicates: Array<{
        id: string;
        caseId: string;
        status: string;
        confidence: number;
        createdAt: string;
      }>;
    }>(`/api/duplicates${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getDuplicate: (id: string) =>
    get<{
      duplicate: {
        id: string;
        caseId: string;
        status: string;
        confidence: number;
        createdAt: string;
      };
    }>(`/api/duplicates/${id}`),
  createDuplicate: (p: { caseId: string; confidence: number }) =>
    post<{
      duplicate: {
        id: string;
        caseId: string;
        status: string;
        confidence: number;
      };
    }>("/api/duplicates", p),
  updateDuplicate: (id: string, p: { status: string }) =>
    patch<{ duplicate: { id: string; status: string } }>(
      `/api/duplicates/${id}`,
      p,
    ),

  // ── party duplicates (merge review + reversal; four-eyes enforced server-side) ──
  listPartyDuplicates: () =>
    get<{
      candidates: Array<{
        id: string;
        orgId: string;
        partyId: string;
        candidatePartyId: string;
        score: number;
        status: string;
        reviewedBy: string | null;
        reviewedAt: string | null;
        survivor: {
          id: string;
          name: string;
          email: string | null;
          company: string | null;
          status: string;
        } | null;
        candidate: {
          id: string;
          name: string;
          email: string | null;
          company: string | null;
          status: string;
        } | null;
      }>;
    }>("/api/parties/duplicates"),
  reviewPartyDuplicate: (
    id: string,
    p: { decision: "CONFIRM" | "DISMISS"; reason?: string },
  ) =>
    post<{
      candidate: { id: string; status: string; reviewedBy: string | null };
    }>("/api/parties/duplicates/" + id + "/review", p),
  executePartyMerge: (
    id: string,
    p: { survivorId: string; absorbedId: string; reason: string },
  ) =>
    post<{
      ledgerId: string;
      receipt: {
        ledgerId: string;
        movedExternalIdentities: number;
        movedConversations: number;
        fieldFills: Record<string, unknown>;
      };
      deduped: boolean;
    }>("/api/parties/duplicates/" + id + "/merge", p),
  getMergePreview: (id: string, survivorId: string, absorbedId: string) =>
    get<{
      plan: {
        survivorId: string;
        absorbedId: string;
        fieldFills: Record<string, string | null>;
        movedRelations: string[];
      };
      absorbedExternalIdentities: number;
      absorbedConversations: number;
    }>(
      "/api/parties/duplicates/" +
        id +
        "/preview?survivor=" +
        encodeURIComponent(survivorId) +
        "&absorbed=" +
        encodeURIComponent(absorbedId),
    ),
  getMergeRestore: (id: string) =>
    get<{
      ledger: { id: string; operation: string };
      record: {
        ledgerId: string;
        survivorId: string;
        absorbedId: string;
        performedBy: string | null;
        confirmerId: string | null;
        survivorSnapshot: { name: string } | null;
        absorbedSnapshot: { name: string } | null;
        fieldFills: Record<string, string | null>;
        movedExternalIdentityIds: string[] | null;
        movedConversationIds: string[] | null;
      };
      currentSurvivor: { status: string } | null;
      currentAbsorbed: { status: string } | null;
    }>("/api/parties/duplicates/" + id + "/restore"),
  restorePartyMerge: (id: string, p: { reason: string }) =>
    post<{ ledgerId: string; absorbedId: string }>(
      "/api/parties/duplicates/" + id + "/restore",
      p,
    ),
  // ── merge-ledger (legacy case-level) ──
  listMergeLedger: (qs?: Record<string, string>) =>
    get<{
      entries: Array<{
        id: string;
        caseId: string;
        source: string;
        target: string;
        reason: string;
        createdAt: string;
      }>;
    }>(`/api/merge-ledger${qs ? `?${new URLSearchParams(qs)}` : ""}`),

  // ── work-items ──
  listWorkItems: (qs?: Record<string, string>) =>
    get<{
      workItems: Array<{
        id: string;
        caseId: string;
        title: string;
        status: string;
        priority: string;
        assignee: string | null;
        dueAt: string | null;
        createdAt: string;
      }>;
    }>(`/api/work-items${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getWorkItem: (id: string) =>
    get<{
      workItem: {
        id: string;
        caseId: string;
        title: string;
        status: string;
        priority: string;
        assignee: string | null;
        dueAt: string | null;
        createdAt: string;
      };
    }>(`/api/work-items/${id}`),
  createWorkItem: (p: {
    caseId: string;
    title: string;
    priority: string;
    assignee?: string;
    dueAt?: string;
  }) =>
    post<{
      workItem: {
        id: string;
        caseId: string;
        title: string;
        status: string;
        priority: string;
      };
    }>("/api/work-items", p),
  updateWorkItem: (
    id: string,
    p: {
      title?: string;
      status?: string;
      priority?: string;
      assignee?: string;
      dueAt?: string;
    },
  ) =>
    patch<{
      workItem: { id: string; title: string; status: string; priority: string };
    }>(`/api/work-items/${id}`, p),

  // ── kyc-checks ──
  listKycChecks: (qs?: Record<string, string>) =>
    get<{
      checks: Array<{
        id: string;
        caseId: string;
        type: string;
        status: string;
        provider: string | null;
        createdAt: string;
      }>;
    }>(`/api/kyc-checks${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getKycCheck: (id: string) =>
    get<{
      check: {
        id: string;
        caseId: string;
        type: string;
        status: string;
        provider: string | null;
        createdAt: string;
      };
    }>(`/api/kyc-checks/${id}`),
  createKycCheck: (p: { caseId: string; type: string; provider?: string }) =>
    post<{
      check: {
        id: string;
        caseId: string;
        type: string;
        status: string;
        provider: string | null;
      };
    }>("/api/kyc-checks", p),
  updateKycCheck: (id: string, p: { status: string }) =>
    patch<{ check: { id: string; status: string } }>(
      `/api/kyc-checks/${id}`,
      p,
    ),

  // ── quotes ──
  listQuotes: (qs?: Record<string, string>) =>
    get<{
      quotes: Array<{
        id: string;
        caseId: string;
        amount: number;
        currency: string;
        status: string;
        validUntil: string | null;
        createdAt: string;
      }>;
    }>(`/api/quotes${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getQuote: (id: string) =>
    get<{
      quote: {
        id: string;
        caseId: string;
        amount: number;
        currency: string;
        status: string;
        validUntil: string | null;
        createdAt: string;
      };
    }>(`/api/quotes/${id}`),
  createQuote: (p: {
    caseId: string;
    amount: number;
    currency: string;
    validUntil?: string;
  }) =>
    post<{
      quote: {
        id: string;
        caseId: string;
        amount: number;
        currency: string;
        status: string;
      };
    }>("/api/quotes", p),
  updateQuote: (id: string, p: { status: string }) =>
    patch<{ quote: { id: string; status: string } }>(`/api/quotes/${id}`, p),

  // ── refunds ──
  listRefunds: (qs?: Record<string, string>) =>
    get<{
      refunds: Array<{
        id: string;
        caseId: string;
        amount: number;
        currency: string;
        status: string;
        reason: string;
        createdAt: string;
      }>;
    }>(`/api/refunds${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getRefund: (id: string) =>
    get<{
      refund: {
        id: string;
        caseId: string;
        amount: number;
        currency: string;
        status: string;
        reason: string;
        createdAt: string;
      };
    }>(`/api/refunds/${id}`),
  createRefund: (p: {
    caseId: string;
    amount: number;
    currency: string;
    reason: string;
  }) =>
    post<{
      refund: {
        id: string;
        caseId: string;
        amount: number;
        currency: string;
        status: string;
      };
    }>("/api/refunds", p),
  updateRefund: (id: string, p: { status: string }) =>
    patch<{ refund: { id: string; status: string } }>(`/api/refunds/${id}`, p),

  // ── handoffs ──
  listHandoffs: (qs?: Record<string, string>) =>
    get<{
      handoffs: Array<{
        id: string;
        caseId: string;
        fromUserId: string;
        toUserId: string;
        reason: string;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/handoffs${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getHandoff: (id: string) =>
    get<{
      handoff: {
        id: string;
        caseId: string;
        fromUserId: string;
        toUserId: string;
        reason: string;
        status: string;
        createdAt: string;
      };
    }>(`/api/handoffs/${id}`),
  createHandoff: (p: { caseId: string; toUserId: string; reason: string }) =>
    post<{
      handoff: {
        id: string;
        caseId: string;
        fromUserId: string;
        toUserId: string;
        status: string;
      };
    }>("/api/handoffs", p),
  updateHandoff: (id: string, p: { status: string }) =>
    patch<{ handoff: { id: string; status: string } }>(
      `/api/handoffs/${id}`,
      p,
    ),

  // ── human-tasks ──
  listHumanTasks: (qs?: Record<string, string>) =>
    get<{
      tasks: Array<{
        id: string;
        caseId: string;
        title: string;
        status: string;
        priority: string;
        assignee: string | null;
        dueAt: string | null;
        createdAt: string;
      }>;
    }>(`/api/human-tasks${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getHumanTask: (id: string) =>
    get<{
      task: {
        id: string;
        caseId: string;
        title: string;
        status: string;
        priority: string;
        assignee: string | null;
        dueAt: string | null;
        createdAt: string;
      };
    }>(`/api/human-tasks/${id}`),
  createHumanTask: (p: {
    caseId: string;
    title: string;
    priority: string;
    assignee?: string;
    dueAt?: string;
  }) =>
    post<{
      task: {
        id: string;
        caseId: string;
        title: string;
        status: string;
        priority: string;
      };
    }>("/api/human-tasks", p),
  updateHumanTask: (
    id: string,
    p: {
      title?: string;
      status?: string;
      priority?: string;
      assignee?: string;
      dueAt?: string;
    },
  ) =>
    patch<{
      task: { id: string; title: string; status: string; priority: string };
    }>(`/api/human-tasks/${id}`, p),

  // ── provider-receipts ──
  listProviderReceipts: (qs?: Record<string, string>) =>
    get<{
      receipts: Array<{
        id: string;
        caseId: string;
        provider: string;
        amount: number;
        currency: string;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/provider-receipts${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getProviderReceipt: (id: string) =>
    get<{
      receipt: {
        id: string;
        caseId: string;
        provider: string;
        amount: number;
        currency: string;
        status: string;
        createdAt: string;
      };
    }>(`/api/provider-receipts/${id}`),
  createProviderReceipt: (p: {
    caseId: string;
    provider: string;
    amount: number;
    currency: string;
  }) =>
    post<{
      receipt: {
        id: string;
        caseId: string;
        provider: string;
        amount: number;
        currency: string;
        status: string;
      };
    }>("/api/provider-receipts", p),
  updateProviderReceipt: (id: string, p: { status: string }) =>
    patch<{ receipt: { id: string; status: string } }>(
      `/api/provider-receipts/${id}`,
      p,
    ),

  // ── citations ──
  listCitations: (qs?: Record<string, string>) =>
    get<{
      citations: Array<{
        id: string;
        caseId: string;
        source: string;
        title: string;
        url: string | null;
        relevance: number;
        createdAt: string;
      }>;
    }>(`/api/citations${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  createCitation: (p: {
    caseId: string;
    source: string;
    title: string;
    url?: string;
    relevance: number;
  }) =>
    post<{
      citation: {
        id: string;
        caseId: string;
        source: string;
        title: string;
        url: string | null;
      };
    }>("/api/citations", p),

  // ── prompts ──
  listPrompts: (qs?: Record<string, string>) =>
    get<{
      prompts: Array<{
        id: string;
        key: string;
        name: string;
        version: number;
        active: boolean;
        createdAt: string;
      }>;
    }>(`/api/prompts${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getPrompt: (id: string) =>
    get<{
      prompt: {
        id: string;
        key: string;
        name: string;
        version: number;
        active: boolean;
        createdAt: string;
      };
    }>(`/api/prompts/${id}`),
  createPrompt: (p: { key: string; name: string; content: string }) =>
    post<{
      prompt: {
        id: string;
        key: string;
        name: string;
        version: number;
        active: boolean;
      };
    }>("/api/prompts", p),

  // ── poll-connections ──
  listPollConnections: (qs?: Record<string, string>) =>
    get<{
      connections: Array<{
        id: string;
        caseId: string;
        channel: string;
        status: string;
        lastPollAt: string | null;
        createdAt: string;
      }>;
    }>(`/api/poll-connections${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getPollConnection: (id: string) =>
    get<{
      connection: {
        id: string;
        caseId: string;
        channel: string;
        status: string;
        lastPollAt: string | null;
        createdAt: string;
      };
    }>(`/api/poll-connections/${id}`),
  createPollConnection: (p: { caseId: string; channel: string }) =>
    post<{
      connection: {
        id: string;
        caseId: string;
        channel: string;
        status: string;
      };
    }>("/api/poll-connections", p),
  updatePollConnection: (id: string, p: { status: string }) =>
    patch<{ connection: { id: string; status: string } }>(
      `/api/poll-connections/${id}`,
      p,
    ),

  // ── availability ──
  listAvailability: (qs?: Record<string, string>) =>
    get<{
      availability: Array<{
        id: string;
        userId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        createdAt: string;
      }>;
    }>(`/api/availability${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getAvailability: (id: string) =>
    get<{
      availability: {
        id: string;
        userId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        createdAt: string;
      };
    }>(`/api/availability/${id}`),
  createAvailability: (p: {
    userId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }) =>
    post<{
      availability: {
        id: string;
        userId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
      };
    }>("/api/availability", p),

  // ── voice ──
  listVoiceCommands: (qs?: Record<string, string>) =>
    get<{
      commands: Array<{
        id: string;
        caseId: string;
        transcript: string;
        intent: string;
        confidence: number;
        createdAt: string;
      }>;
    }>(`/api/voice/commands${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  listVoiceNotes: (qs?: Record<string, string>) =>
    get<{
      notes: Array<{
        id: string;
        caseId: string;
        transcript: string;
        summary: string | null;
        createdAt: string;
      }>;
    }>(`/api/voice/notes${qs ? `?${new URLSearchParams(qs)}` : ""}`),

  // ── business-settings ──
  listBusinessSettings: () =>
    get<{ settings: Array<{ key: string; value: string; updatedAt: string }> }>(
      "/api/business-settings",
    ),
  getBusinessSetting: (key: string) =>
    get<{ setting: { key: string; value: string; updatedAt: string } }>(
      `/api/business-settings/${key}`,
    ),
  updateBusinessSetting: (key: string, p: { value: string }) =>
    patch<{ setting: { key: string; value: string } }>(
      `/api/business-settings/${key}`,
      p,
    ),

  // ── form-schemas ──
  listFormSchemas: (qs?: Record<string, string>) =>
    get<{
      schemas: Array<{
        id: string;
        key: string;
        name: string;
        version: number;
        active: boolean;
        createdAt: string;
      }>;
    }>(`/api/form-schemas${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getFormSchema: (id: string) =>
    get<{
      schema: {
        id: string;
        key: string;
        name: string;
        version: number;
        active: boolean;
        createdAt: string;
      };
    }>(`/api/form-schemas/${id}`),
  createFormSchema: (p: {
    key: string;
    name: string;
    schema: Record<string, unknown>;
  }) =>
    post<{
      schema: {
        id: string;
        key: string;
        name: string;
        version: number;
        active: boolean;
      };
    }>("/api/form-schemas", p),
  updateFormSchema: (
    id: string,
    p: { name?: string; schema?: Record<string, unknown>; active?: boolean },
  ) =>
    patch<{
      schema: { id: string; name: string; version: number; active: boolean };
    }>(`/api/form-schemas/${id}`, p),

  // ── attachments ──
  listAttachments: (qs?: Record<string, string>) =>
    get<{
      attachments: Array<{
        id: string;
        caseId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        createdAt: string;
      }>;
    }>(`/api/attachments${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getAttachment: (id: string) =>
    get<{
      attachment: {
        id: string;
        caseId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        createdAt: string;
      };
    }>(`/api/attachments/${id}`),
  createAttachment: (p: {
    caseId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) =>
    post<{
      attachment: {
        id: string;
        caseId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      };
    }>("/api/attachments", p),

  // ── mcp ──
  listMcpTools: () =>
    get<{
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }>;
    }>("/api/mcp/tools"),
  listMcpCalls: (qs?: Record<string, string>) =>
    get<{
      calls: Array<{
        id: string;
        toolName: string;
        status: string;
        durationMs: number | null;
        createdAt: string;
      }>;
    }>(`/api/mcp/calls${qs ? `?${new URLSearchParams(qs)}` : ""}`),

  // ── offline ──
  listOfflineQueue: (qs?: Record<string, string>) =>
    get<{
      items: Array<{
        id: string;
        action: string;
        payload: Record<string, unknown>;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/offline/queue${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getOfflineSyncState: () =>
    get<{
      syncState: {
        lastSyncAt: string | null;
        pendingCount: number;
        conflictCount: number;
      };
    }>("/api/offline/sync-state"),

  // ── webhook-inbox ──
  listWebhookInbox: (qs?: Record<string, string>) =>
    get<{
      entries: Array<{
        id: string;
        topic: string;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/webhook-inbox${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getWebhookInboxEntry: (id: string) =>
    get<{
      entry: {
        id: string;
        topic: string;
        status: string;
        body: Record<string, unknown>;
        createdAt: string;
      };
    }>(`/api/webhook-inbox/${id}`),

  // ── conversations ──
  listConversations: (qs?: Record<string, string>) =>
    get<{
      conversations: Array<{
        id: string;
        orgId: string;
        caseId: string | null;
        partyId: string | null;
        channel: string;
        status: string;
        subject: string;
        ownerId: string | null;
        lastMessageAt: string | null;
        messageCount: number;
        createdAt: string;
        updatedAt: string;
      }>;
    }>(`/api/conversations${qs ? `?${new URLSearchParams(qs)}` : ""}`),
  getConversation: (id: string) =>
    get<{
      conversation: {
        id: string;
        orgId: string;
        caseId: string | null;
        partyId: string | null;
        channel: string;
        status: string;
        subject: string;
        ownerId: string | null;
        lastMessageAt: string | null;
        messageCount: number;
        createdAt: string;
        updatedAt: string;
        messages: Array<{
          id: string;
          conversationId: string;
          senderId: string;
          senderType: string;
          content: string;
          contentType: string;
          status: string;
          providerId: string | null;
          replyToId: string | null;
          metadata: unknown;
          sentAt: string;
          createdAt: string;
        }>;
        participants: Array<{
          id: string;
          conversationId: string;
          participantId: string;
          role: string;
        }>;
        case: { id: string; publicRef: string; status: string } | null;
        party: { id: string; name: string; email: string } | null;
        owner: { id: string; name: string; email: string } | null;
      };
    }>(`/api/conversations/${id}`),
  createConversation: (input: {
    caseId?: string;
    partyId?: string;
    channel: string;
    subject?: string;
    ownerId?: string;
    participantIds?: string[];
  }) =>
    post<{
      conversation: {
        id: string;
        orgId: string;
        caseId: string | null;
        partyId: string | null;
        channel: string;
        status: string;
        subject: string;
        ownerId: string | null;
        lastMessageAt: string | null;
        messageCount: number;
        createdAt: string;
        updatedAt: string;
      };
    }>("/api/conversations", { action: "create", ...input }),
  sendConversationMessage: (
    conversationId: string,
    input: {
      senderType?: string;
      content: string;
      contentType?: string;
      replyToId?: string;
    },
  ) =>
    post<{
      message: {
        id: string;
        conversationId: string;
        senderId: string;
        senderType: string;
        content: string;
        contentType: string;
        status: string;
        providerId: string | null;
        replyToId: string | null;
        metadata: unknown;
        sentAt: string;
        createdAt: string;
      };
    }>("/api/conversations", { action: "send", conversationId, ...input }),
  conversationAction: (
    id: string,
    action: "close" | "reopen" | "archive" | "assign",
    ownerId?: string,
  ) =>
    post<{ ok: true }>(`/api/conversations/${id}/actions`, {
      action,
      ...(ownerId ? { ownerId } : undefined),
    }),
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  description: string;
  events: string[];
  active: boolean;
  secretHint: string;
  createdAt: string;
  updatedAt: string;
  counts: { total: number; succeeded: number; failed: number; pending: number };
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  topic: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  correlationId: string | null;
  createdAt: string;
};

export type WfNode = {
  key: string;
  pieceKey: string;
  name: string;
  config: Record<string, unknown>;
};
export type WfEdge = { from: string; to: string; label?: string };
export type LaneBlock = {
  key: string;
  type: string;
  config: Record<string, unknown>;
};
export type LaneBinding = {
  formKey: string;
  workflowId: string;
  nodeKey?: string;
};
