import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";
import { newCorrelationId, type AuthContext } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/csrf";
import { errorCodeForStatus, reportError } from "@/lib/errors";
import { ApiRequestError } from "./api-errors";
import type { ApiErrorCode } from "./api-envelope";

/** HTTP status for a typed API error code (merge-lane evidence: unmapped codes fell to 500). */
const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  STALE_VERSION: 409,
  PROVIDER_DEGRADED: 502,
  RETRYABLE: 503,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  POLICY_BLOCKED: 403,
  INTERNAL_ERROR: 500,
};
import { captureServerError } from "@/lib/telemetry/errors";

export function jsonOk(data: unknown, init?: number) {
  return NextResponse.json(data as object, { status: init ?? 200 });
}

function jsonError(err: unknown, correlationId?: string) {
  // Consistent error envelope: human `error`, numeric `code` (legacy), stable
  // machine-readable `errorCode`, and the `correlationId` so a user-reported
  // failure can be traced to the exact request. Internal details never leak.
  if (err instanceof DomainError) {
    // Report 5xx DomainErrors to telemetry — they indicate genuine internal failures
    if (err.status >= 500) {
      reportError(err, { correlationId });
      void captureServerError(err, { correlationId, scope: "api" });
    }
    return NextResponse.json(
      {
        error: err.message,
        code: err.status,
        errorCode: errorCodeForStatus(err.status),
        ...(correlationId ? { correlationId } : {}),
      },
      { status: err.status },
    );
  }
  // Typed API errors carry their own status (merge-lane evidence: helpers like
  // notFound/validationFailed/forbidden fell through to a misleading 500).
  // Details ride along — they are service-authored like the message itself.
  if (err instanceof ApiRequestError) {
    const status = API_ERROR_STATUS[err.code] ?? 500;
    if (status >= 500) {
      reportError(err, { correlationId });
      void captureServerError(err, { correlationId, scope: "api" });
    }
    return NextResponse.json(
      {
        error: err.message,
        code: status,
        errorCode: errorCodeForStatus(status),
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
      { status },
    );
  }
  reportError(err, { correlationId });
  // Persist to the error-telemetry ledger too (best-effort, fire-and-forget) so
  // an unhandled 500 is visible in the admin console without an external APM.
  void captureServerError(err, { correlationId, scope: "api" });
  return NextResponse.json(
    {
      error: "Internal error",
      code: 500,
      errorCode: "internal_error",
      ...(correlationId ? { correlationId } : {}),
    },
    { status: 500 },
  );
}

/** Wrap a route handler with error mapping + correlation id. */
export function handler(
  fn: (req: NextRequest, correlationId: string) => Promise<Response>
) {
  return async (req: NextRequest) => {
    const correlationId = req.headers.get("x-correlation-id") ?? newCorrelationId();
    try {
      assertSameOrigin(req);
      const res = await fn(req, correlationId);
      res.headers.set("x-correlation-id", correlationId);
      return res instanceof NextResponse ? res : new NextResponse(res.body, res);
    } catch (err) {
      // The correlation id rides on errors too: a user-reported failure must
      // be traceable to the exact request even when the request failed.
      const res = jsonError(err, correlationId);
      res.headers.set("x-correlation-id", correlationId);
      return res;
    }
  };
}

/** Append-only audit trail. Never throws into request path. */
export async function audit(entry: {
  orgId?: string | null;
  actorId?: string | null;
  actorLabel?: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  correlationId?: string;
  ip?: string;
}) {
  try {
    await db.auditEvent.create({
      data: {
        orgId: entry.orgId ?? undefined,
        actorId: entry.actorId ?? undefined,
        actorLabel: entry.actorLabel ?? "system",
        action: entry.action,
        target: entry.target,
        before: entry.before !== undefined ? JSON.stringify(entry.before) : undefined,
        after: entry.after !== undefined ? JSON.stringify(entry.after) : undefined,
        reason: entry.reason,
        correlationId: entry.correlationId,
        ip: entry.ip,
      },
    });
  } catch (e) {
    console.error("[audit] failed to record event", e);
  }
}

export function actorLabel(ctx: AuthContext) {
  return `${ctx.name} <${ctx.email}> [${ctx.role}]`;
}

/** Redact obvious secret-looking keys from any object destined for logs/previews. */
export function redact(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  // Preserve arrays as arrays (the previous shape turned them into objects).
  if (Array.isArray(obj)) return obj.map((v) => redact(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/pass|secret|token|auth|key|number|document/i.test(k) && typeof v === "string" && v.length > 3) {
      out[k] = `${v.slice(0, 2)}•••`;
    } else if (typeof v === "object" && v !== null) {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Parse body safely. */
export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new DomainError("Invalid JSON body", 400);
  }
}

/** Basic magic-byte sniffing for upload safety (MIME claims are never trusted). */
export function sniffMime(base64: string): "pdf" | "image" | "unknown" {
  const buf = Buffer.from(base64.slice(0, 16), "base64");
  const hex = buf.toString("hex");
  if (hex.startsWith("25504446")) return "pdf"; // %PDF
  if (hex.startsWith("ffd8ff")) return "image"; // JPEG
  if (hex.startsWith("89504e47")) return "image"; // PNG
  if (hex.startsWith("424d")) return "image"; // BMP
  return "unknown";
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB cap
