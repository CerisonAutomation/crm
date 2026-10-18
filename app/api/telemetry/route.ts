/**
 * POST /api/telemetry — public batch ingest for product telemetry (task 11-b).
 *
 * Design contract: telemetry must NEVER break the app. Every failure mode —
 * bad JSON, invalid shapes, DB errors, prune errors — resolves to a silent
 * 204 so clients never retry-storm or surface errors. No auth is required;
 * when a valid session happens to ride along (cookie or bearer), the
 * userId/orgId are attached opportunistically. User-Agent is stored for
 * coarse device context; IP addresses are NEVER read or stored (privacy).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, redact } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { pruneTelemetry, TELEMETRY_RETENTION_DAYS } from "@/lib/telemetry/prune";
import { hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const KINDS = new Set(["view", "event", "error", "api"]);
const MAX_BATCH = 25;
const MAX_NAME = 80;
const MAX_SESSION = 64;
const MAX_PROPS_BYTES = 2048;
const MAX_DURATION_MS = 600000;
/** Marker stored when a payload exceeds the props cap (kept honest, never silently dropped). */
const TRUNCATED_PROPS = '{"cl.truncated":true}';

type IncomingEvent = Record<string, unknown>;

type TelemetryRow = {
  kind: string;
  name: string;
  sessionId: string;
  view?: string;
  path?: string;
  locale?: string;
  role?: string;
  props?: string;
  durationMs?: number;
  status?: number;
};

/** Trimmed string or undefined — optional fields never arrive as non-strings. */
function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

/** Validate/normalize one incoming event; null when the shape is invalid. */
function normalize(e: unknown): TelemetryRow | null {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return null;
  const raw = e as IncomingEvent;

  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  if (!KINDS.has(kind)) return null;

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return null;

  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim().slice(0, MAX_SESSION) : "";
  if (!sessionId) return null;

  // props: object (non-array) → redact secrets → JSON string → size cap.
  let props: string | undefined;
  if (typeof raw.props === "object" && raw.props !== null && !Array.isArray(raw.props)) {
    try {
      const json = JSON.stringify(redact(raw.props));
      props = json.length <= MAX_PROPS_BYTES ? json : TRUNCATED_PROPS;
    } catch {
      props = undefined; // circular/etc — drop payload, keep the event
    }
  }

  const durationMs =
    typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)
      ? Math.min(MAX_DURATION_MS, Math.max(0, Math.round(raw.durationMs)))
      : undefined;

  const status =
    typeof raw.status === "number" && Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599
      ? raw.status
      : undefined;

  return {
    kind,
    name,
    sessionId,
    view: str(raw.view, MAX_NAME),
    path: str(raw.path, 256),
    locale: str(raw.locale, 16),
    role: str(raw.role, 40),
    props,
    durationMs,
    status,
  };
}

export async function POST(req: NextRequest) {
  try {
    // S7 flood gate: public ingest is capped per IP (generous budget — normal
    // clients never notice). Over-limit batches are dropped SILENTLY with the
    // same 204, so the never-break contract holds. The IP feeds only this
    // in-memory bucket key and is never persisted (see header contract).
    const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
    if (!hit(`telemetry:${ip}`, 120, 60_000).allowed) return new NextResponse(null, { status: 204 });
    const body: unknown = await req.json().catch(() => null);
    const events: unknown = (typeof body === "object" && body !== null && !Array.isArray(body))
      ? (body as { events?: unknown }).events
      : undefined;

    if (Array.isArray(events) && events.length > 0) {
      // Optional identity — never required, never blocking.
      let actor: { userId: string; orgId: string; role: string } | null = null;
      try {
        const ctx = await requireAuth(req);
        actor = { userId: ctx.userId, orgId: ctx.orgId, role: ctx.role };
      } catch {
        actor = null; // anonymous surface (landing/login) or stale session
      }
      const userAgent = str(req.headers.get("user-agent"), 256);

      const rows = events
        .slice(0, MAX_BATCH)
        .map(normalize)
        .filter((r): r is TelemetryRow => r !== null)
        .map((r) => ({
          ...r,
          orgId: actor?.orgId,
          userId: actor?.userId,
          role: r.role ?? actor?.role,
          userAgent,
        }));

      if (rows.length > 0) {
        try {
          await db.telemetryEvent.createMany({ data: rows });
        } catch {
          /* DB hiccup — telemetry never breaks the response */
        }
      }

      // Probabilistic self-cleaning (~2% of ingest calls) — never throws.
      if (Math.random() < 0.02) {
        try {
          await pruneTelemetry(TELEMETRY_RETENTION_DAYS);
        } catch {
          /* housekeeping is best-effort */
        }
      }
    }
  } catch {
    /* absolute backstop — telemetry must never 4xx/5xx */
  }
  return new NextResponse(null, { status: 204 });
}

/**
 * GET /api/telemetry — staff/admin read of the product-telemetry ledger,
 * org-scoped. `?prune=1` runs retention housekeeping on demand.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);

    if (url.searchParams.get("prune") === "1") {
      // Destructive housekeeping — ADMIN-only. The read gate below is held by
      // the read-only AUDITOR, who must never be able to delete rows.
      requireCapability(ctx, "automation.manage");
      const pruned = await pruneTelemetry(TELEMETRY_RETENTION_DAYS);
      return jsonOk({ pruned });
    }

    const take = Math.min(Number(url.searchParams.get("take") ?? 100), 500);
    const kind = url.searchParams.get("kind") ?? undefined;
    const where = { orgId: ctx.orgId, ...(kind ? { kind } : {}) };
    const [events, byKind] = await Promise.all([
      db.telemetryEvent.findMany({ where, orderBy: { createdAt: "desc" }, take }),
      db.telemetryEvent.groupBy({ by: ["kind"], where: { orgId: ctx.orgId }, _count: true }),
    ]);
    return jsonOk({ events, counts: byKind.map((b) => ({ kind: b.kind, count: b._count })) });
  })(req);
}
