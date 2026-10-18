/**
 * Error handling primitives — one place to DESCRIBE, LOG and REPORT errors.
 *
 * Isomorphic (no Node/Prisma imports) so both the API layer and React error
 * boundaries can use it. Every function here is best-effort and must NEVER
 * throw: a reporting path that fails must not become a second error.
 */

export type ErrorContext = Record<string, unknown>;

/** Stable, machine-readable code for an HTTP status. */
const STATUS_ERROR_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "internal_error",
  502: "bad_gateway",
  503: "service_unavailable",
  504: "gateway_timeout",
};

export function errorCodeForStatus(status: number): string {
  return STATUS_ERROR_CODES[status] ?? (status >= 500 ? "server_error" : "request_error");
}

export type DescribedError = { name: string; message: string; code: string; stack?: string };

/** Normalise any thrown value into a compact, log-safe description. */
export function describeError(err: unknown): DescribedError {
  if (err instanceof Error) {
    const withStatus = err as Error & { status?: number };
    return {
      name: err.name || "Error",
      message: err.message || "Unknown error",
      code: typeof withStatus.status === "number" ? errorCodeForStatus(withStatus.status) : "error",
      stack: err.stack,
    };
  }
  return {
    name: "NonError",
    message: typeof err === "string" ? err : "Unknown error",
    code: "error",
  };
}

/** Keep context values primitive + bounded so logs never dump whole objects/PII. */
function shrink(ctx: ErrorContext): ErrorContext {
  const out: ErrorContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    // objects/arrays are intentionally dropped — callers pass curated primitives.
  }
  return out;
}

/** Structured server-side log for an error. Never throws. */
export function reportError(err: unknown, context: ErrorContext = {}): void {
  try {
    const d = describeError(err);
    console.error(`[error] ${d.code} ${d.name}: ${d.message}`, shrink(context));
  } catch {
    /* logging must never throw */
  }
}

const SESSION_KEY = "cl.telemetry.session";

/** Stable per-tab id used to group client telemetry. Never throws. */
export function ensureSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = (
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    ).slice(0, 64);
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "unknown";
  }
}

/**
 * Report a client-side error to the telemetry ledger. Fire-and-forget with
 * `keepalive` so it survives a navigation; it never throws, never blocks the UI,
 * and never retries (the ingest endpoint is a silent 204 by design).
 */
export function reportClientError(err: unknown, context: ErrorContext = {}): void {
  if (typeof window === "undefined") return;
  try {
    const d = describeError(err);
    const name = `${d.name}: ${d.message}`.slice(0, 80);
    const body = JSON.stringify({
      events: [
        {
          kind: "error",
          name,
          sessionId: ensureSessionId(),
          path: window.location.pathname,
          props: shrink(context),
        },
      ],
    });
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}
