/**
 * Server-side error telemetry — the in-app "error tracker".
 *
 * The platform has no external APM, so a server error that is not tied to a
 * request has nowhere to go. This module persists a compact error record to the
 * same `TelemetryEvent` ledger the client already writes to (kind = "error"), so
 * an operator can see failures from ONE place — the admin telemetry console —
 * without a Sentry account.
 *
 * Contract mirrors the client reporter: best-effort, never throws, never blocks
 * the caller. A failure to RECORD an error must not become a second error. Only
 * a bounded set of primitives is stored (no stack traces, no request bodies),
 * and the row is scoped to an org/user only when the caller already knows them.
 */
import { db } from "@/lib/db";
import { describeError, type ErrorContext } from "@/lib/errors";

const MAX_NAME = 200;
const MAX_PROPS_BYTES = 2048;

function shrinkToString(context: ErrorContext): string | null {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    // objects/arrays dropped — callers pass curated primitives (same rule as errors.ts)
  }
  const json = JSON.stringify(out);
  return json === "{}" ? null : json.slice(0, MAX_PROPS_BYTES);
}

/**
 * Persist one server-side error to the telemetry ledger. Best-effort: any
 * failure (DB down, malformed context) is swallowed.
 */
export async function captureServerError(err: unknown, context: ErrorContext = {}): Promise<void> {
  try {
    const d = describeError(err);
    const name = `${d.code}: ${d.name}: ${d.message}`.slice(0, MAX_NAME);
    const orgId = typeof context.orgId === "string" ? context.orgId : null;
    const userId = typeof context.userId === "string" ? context.userId : null;
    const path = typeof context.path === "string" ? context.path.slice(0, 300) : null;
    await db.telemetryEvent.create({
      data: {
        orgId,
        userId,
        sessionId: "server",
        kind: "error",
        name,
        path,
        props: shrinkToString(context),
      },
    });
  } catch {
    /* error tracking must never throw */
  }
}
