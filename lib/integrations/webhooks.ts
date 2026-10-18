/**
 * Outbound webhook dispatcher — signed, per-event, retrying, observable.
 *
 * Every platform event that flows through emitAutomationEvent is ALSO fanned
 * out to admin-managed WebhookEndpoints subscribed to its topic. Each delivery
 * is a WebhookDelivery row and a real HTTP POST signed with the endpoint's
 * secret:
 *
 *   X-CL-Topic       the event topic (e.g. "document.uploaded")
 *   X-CL-Event-Id    the WebhookDelivery id (idempotency key for receivers)
 *   X-CL-Timestamp   unix millis at signing time
 *   X-CL-Signature   "sha256=" + HMAC-SHA256(`${timestamp}.${rawBody}`, secret)
 *
 * Failed attempts retry with exponential backoff (30s / 2m / 10m / 60m, max 5
 * attempts) via an in-process timer queue that lives on globalThis (survives
 * HMR) plus a catch-up sweep — any webhook API route processes due retries
 * before answering, so deliveries recover even after a server restart.
 *
 * Nothing here ever throws into the caller: webhook failure never blocks a
 * business flow.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "@/lib/db";
import {
  assertOutboundUrl,
  isBlockedAddress,
} from "@/lib/security/outbound-url";
import { scrubPII, isTrustedRelayUrl } from "@/lib/domain/pii";
import { isServerless } from "@/lib/deployment";
import {
  noteSweeperRun,
  sweepOverlapCountSinceBoot,
} from "@/lib/automation/scheduler";

// Single source of truth for IP-range blocking lives in the shared guard;
// re-exported here so any existing caller keeps working unchanged.
export { isBlockedAddress };

// ───────────────────────── tuning constants ─────────────────────────

export const WEBHOOK_TIMEOUT_MS = 8_000;
/** Hard cap of delivery attempts per WebhookDelivery row. */
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** Exponential backoff delays (ms) — index i is the wait BEFORE attempt i+2. */
export const WEBHOOK_RETRY_DELAYS_MS = [
  30_000, 120_000, 600_000, 3_600_000,
] as const;
/** How often the lazily-started catch-up sweep scans for due retries. */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * The canonical outbound topic catalogue (drives admin UI + server-side
 * validation). "*" subscribes an endpoint to every topic.
 */
export const WEBHOOK_TOPICS = [
  "case.created",
  "document.uploaded",
  "document.approved",
  "document.rejected",
  "case.status.changed",
  "dispatch.created",
  "letter.issued",
  "message.received",
  "page.submitted",
  "workflow.run.completed",
  "webhook.test",
] as const;
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

// ───────────────────────── process-scoped state (HMR-safe) ─────────────────────────

type WebhookGlobal = {
  /** per-delivery retry timers (setTimeout handles) */
  __clWebhookTimers?: Map<string, ReturnType<typeof setTimeout>>;
  /** deliveries currently being attempted (dedupe across timers + sweeps) */
  __clWebhookInflight?: Set<string>;
  /** interval handle of the catch-up sweep (started lazily once) */
  __clWebhookSweep?: ReturnType<typeof setInterval>;
};
const g = globalThis as unknown as WebhookGlobal;
const timers = (g.__clWebhookTimers ??= new Map());
const inflight = (g.__clWebhookInflight ??= new Set());

// ───────────────────────── signing ─────────────────────────

/** HMAC-SHA256 over `${timestamp}.${rawBody}` with the endpoint secret. */
export function signPayload(
  secret: string,
  timestamp: string,
  rawBody: string
): string {
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `sha256=${mac}`;
}

/** Constant-time verification helper for receivers (and our own tests). */
export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** 32-byte hex secret — returned to the admin exactly once. */
export function generateEndpointSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Mask a secret for list views — FIXED output, never plaintext after creation.
 * Fixed (not first2+last2): a variable mask leaks the secret length, and
 * length is a real oracle input for offline brute-force budgeting. THE single
 * mask helper (ponytail-S #7) — autopilot re-exports this instead of its own.
 */
export function maskSecret(_secret: string): string {
  return "••••••";
}

// ───────────────────────── SSRF guard ─────────────────────────
//
// Two layers, both required:
//
//   1. `assertOutboundUrl` (src/lib/security/outbound-url.ts) — the shared,
//      pure guard. Rejects non-http(s) schemes, missing / `localhost` /
//      `*.local` hosts, non-standard ports, and any LITERAL private / loopback
//      / link-local / metadata IP. No DNS, no I/O.
//   2. DNS resolution here — a public hostname that resolves into private
//      space (e.g. `metadata.google.internal` → 169.254.169.254) is rejected
//      before any request is made.
//
// Together they stop the deliverer from being steered at internal
// infrastructure; `redirect: "manual"` on the fetch (see postSigned) closes the
// redirect-based variant. Returns a rejection outcome instead of throwing —
// this module never throws into callers.

/**
 * SSRF guard for admin-supplied webhook endpoints. Runs the shared pure guard,
 * then resolves the host and rejects any address in private / loopback /
 * link-local / metadata space.
 */
export async function assertPublicWebhookTarget(
  rawUrl: string,
  /**
   * `allowedPorts` is threaded through for connectors that legitimately listen
   * on a non-standard port (a self-hosted service on :5678). The scheme and
   * host/DNS checks below — the ones that actually stop SSRF — always run.
   */
  opts: { allowedPorts?: readonly number[] } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = assertOutboundUrl(rawUrl, opts);
  if (!base.ok) return { ok: false, error: base.error };
  const hostname = base.hostname;

  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true })).map((r) => r.address);
    } catch {
      return { ok: false, error: "blocked: dns resolution failed" };
    }
  }
  if (addresses.length === 0)
    return { ok: false, error: "blocked: dns resolution failed" };
  if (addresses.some(isBlockedAddress))
    return { ok: false, error: "blocked: private/loopback address" };
  return { ok: true };
}

// ───────────────────────── subscriptions ─────────────────────────

/** Active endpoints subscribed to a topic (per-endpoint JSON events, "*" wildcard). */
export async function endpointsForTopic(topic: string, orgId?: string | null) {
  // Tenant scoping: an endpoint bound to an organisation receives ONLY that
  // organisation's events; a platform-wide endpoint (`orgId` null) receives
  // every event. When the emitting event carries no organisation there is
  // nothing to attribute it to, so only the platform-wide endpoints qualify —
  // handing an unattributable event to a specific tenant would leak another
  // tenant's data (applicant names, references, document names).
  const rows = await db.webhookEndpoint.findMany({
    where: orgId
      ? { active: true, OR: [{ orgId }, { orgId: null }] }
      : { active: true, orgId: null },
  });
  return rows.filter((row) => {
    let events: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.events);
      events = Array.isArray(parsed)
        ? parsed.filter((e): e is string => typeof e === "string")
        : [];
    } catch {
      events = [];
    }
    return events.includes("*") || events.includes(topic);
  });
}

// ───────────────────────── delivery engine ─────────────────────────

type AttemptOutcome = {
  ok: boolean;
  responseStatus: number | null;
  error: string | null;
};

/** POST one signed delivery. Never throws — network errors become outcomes. */
async function postSigned(
  endpoint: { url: string; secret: string },
  deliveryId: string,
  topic: string,
  rawBody: string
): Promise<AttemptOutcome> {
  const guard = await assertPublicWebhookTarget(endpoint.url);
  if (!guard.ok) return { ok: false, responseStatus: null, error: guard.error };
  const timestamp = Date.now().toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CL-Topic": topic,
        "X-CL-Event-Id": deliveryId,
        "X-CL-Timestamp": timestamp,
        "X-CL-Signature": signPayload(endpoint.secret, timestamp, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
      // Never follow redirects: the SSRF guard above validated only this URL, so
      // a public endpoint answering 3xx with Location: http://169.254.169.254/…
      // (or any loopback/private host) would otherwise make us re-send the signed
      // body to that target. A redirect is treated as a failed delivery.
      redirect: "manual",
    });
    if (res.ok) return { ok: true, responseStatus: res.status, error: null };
    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        responseStatus: res.status,
        error: `endpoint redirected (${res.status}) — redirects are not followed`,
      };
    }
    return {
      ok: false,
      responseStatus: res.status,
      error: `endpoint responded ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown delivery error";
    return {
      ok: false,
      responseStatus: null,
      error: controller.signal.aborted
        ? `timeout after ${WEBHOOK_TIMEOUT_MS}ms`
        : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one attempt for a delivery row and persist the outcome. Status mirrors
 * the LAST attempt: SUCCEEDED when delivered, FAILED after a failed attempt
 * (with nextAttemptAt set while retries remain), PENDING only while queued.
 * Never throws.
 */
async function attemptDelivery(deliveryId: string): Promise<void> {
  if (inflight.has(deliveryId)) return;
  inflight.add(deliveryId);
  try {
    const delivery = await db.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery || !delivery.endpoint || delivery.status === "SUCCEEDED")
      return;
    if (!delivery.endpoint.active) {
      await db.webhookDelivery
        .update({
          where: { id: deliveryId },
          data: {
            status: "FAILED",
            error: "endpoint deactivated before retry",
          },
        })
        .catch(() => undefined);
      return;
    }

    const outcome = await postSigned(
      { url: delivery.endpoint.url, secret: delivery.endpoint.secret },
      delivery.id,
      delivery.topic,
      delivery.payload
    );
    const attempts = delivery.attempts + 1;
    const retriesLeft = !outcome.ok && attempts < WEBHOOK_MAX_ATTEMPTS;
    const delay = retriesLeft
      ? WEBHOOK_RETRY_DELAYS_MS[
          Math.min(attempts - 1, WEBHOOK_RETRY_DELAYS_MS.length - 1)
        ]
      : null;

    await db.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: {
          status: outcome.ok ? "SUCCEEDED" : "FAILED",
          attempts,
          responseStatus: outcome.responseStatus,
          error: outcome.error,
          lastAttemptAt: new Date(),
          deliveredAt: outcome.ok ? new Date() : null,
          nextAttemptAt: delay ? new Date(Date.now() + delay) : null,
        },
      })
      .catch(() => undefined);

    if (delay) scheduleRetry(deliveryId, delay);

    // Mirror the outcome into the OutboxEvent ledger (today's observability pattern).
    await db.outboxEvent
      .create({
        data: {
          topic: `webhook.${delivery.topic}`,
          payload: JSON.stringify({
            topic: delivery.topic,
            endpointId: delivery.endpointId,
            endpointUrl: delivery.endpoint.url,
            deliveryId: delivery.id,
            attempts,
            delivered: outcome.ok,
            responseStatus: outcome.responseStatus,
            error: outcome.error,
            nextAttemptAt: delay
              ? new Date(Date.now() + delay).toISOString()
              : null,
          }),
          status: outcome.ok ? "PROCESSED" : "DEAD_LETTER",
          attempts: 1,
          correlationId: delivery.correlationId,
          processedAt: outcome.ok ? new Date() : null,
        },
      })
      .catch(() => undefined);
  } catch (err) {
    console.warn(
      "[webhooks] attempt failed to record:",
      (err as Error).message
    );
  } finally {
    inflight.delete(deliveryId);
  }
}

/** One-shot in-process timer for a due retry (deduped per delivery). */
function scheduleRetry(deliveryId: string, delayMs: number): void {
  if (timers.has(deliveryId)) return;
  const handle = setTimeout(() => {
    timers.delete(deliveryId);
    void attemptDelivery(deliveryId);
  }, delayMs);
  if (typeof handle.unref === "function") handle.unref(); // never keep the process alive for a retry
  timers.set(deliveryId, handle);
}

/**
 * Catch-up sweep — picks up every PENDING/FAILED delivery whose
 * nextAttemptAt has passed (restart-proof retry queue). Returns the number of
 * retries that were due and kicked off.
 */
export async function processDueRetries(limit = 25): Promise<number> {
  try {
    const due = await db.webhookDelivery.findMany({
      where: {
        nextAttemptAt: { not: null, lte: new Date() },
        status: { in: ["PENDING", "FAILED"] },
        attempts: { lt: WEBHOOK_MAX_ATTEMPTS },
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      select: { id: true },
    });
    for (const d of due) void attemptDelivery(d.id);
    if (due.length > 0) {
      console.warn(
        `[webhooks] catch-up sweep: ${due.length} due retry(ies) dispatched`
      );
    }
    return due.length;
  } catch (err) {
    console.warn("[webhooks] sweep failed:", (err as Error).message);
    return 0;
  }
}

/** Lazily start the periodic catch-up sweep (once per process, HMR-safe). */
function ensureSweep(): void {
  if (g.__clWebhookSweep) return;
  // P0-2 runner decision: serverless hosts freeze timers — /api/cron/tick
  // owns the retry cadence there; the in-process sweep runs only off serverless.
  if (isServerless()) return;
  g.__clWebhookSweep = setInterval(() => {
    const overlap = noteSweeperRun("in-process");
    if (overlap) {
      console.warn(
        `[automation] sweep overlap: ${
          overlap.driver
        } driver swept recently — duplicate work, idempotent (count=${sweepOverlapCountSinceBoot()})`
      );
    }
    void processDueRetries();
  }, SWEEP_INTERVAL_MS);
  if (typeof g.__clWebhookSweep.unref === "function")
    g.__clWebhookSweep.unref();
}

// ───────────────────────── public API ─────────────────────────

export type DispatchSummary = {
  topic: string;
  endpoints: number;
  deliveries: Array<{
    deliveryId: string;
    endpointId: string;
    delivered: boolean;
    attempts: number;
    responseStatus: number | null;
    error: string | null;
  }>;
};

/**
 * Fan a topic + payload out to every active subscribed endpoint. Creates one
 * WebhookDelivery per endpoint, performs the first signed POST immediately,
 * and schedules exponential-backoff retries on failure. Never throws — the
 * caller can safely `void dispatchWebhook(...)`.
 */
export async function dispatchWebhook(
  topic: string,
  payload: unknown,
  correlationId?: string,
  orgId?: string | null
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { topic, endpoints: 0, deliveries: [] };
  try {
    ensureSweep();
    const endpoints = await endpointsForTopic(topic, orgId);
    if (endpoints.length === 0) return summary;
    summary.endpoints = endpoints.length;

    for (const endpoint of endpoints) {
      // PII boundary — a registered endpoint is an external system, so its
      // payload is scrubbed before it leaves the process (a same-deployment
      // relay is exempt). The stored delivery row keeps the exact body that was
      // sent, so the outbox is a faithful record of what was disclosed.
      const data = isTrustedRelayUrl(endpoint.url)
        ? payload
        : scrubPII(payload);
      const rawBody = JSON.stringify({
        event: topic,
        occurredAt: new Date().toISOString(),
        correlationId: correlationId ?? null,
        data,
      });
      const delivery = await db.webhookDelivery
        .create({
          data: {
            endpointId: endpoint.id,
            topic,
            payload: rawBody,
            status: "PENDING",
            correlationId: correlationId ?? null,
          },
        })
        .catch(() => null);
      if (!delivery) continue;

      await attemptDelivery(delivery.id);
      const fresh = await db.webhookDelivery
        .findUnique({
          where: { id: delivery.id },
          select: {
            attempts: true,
            status: true,
            responseStatus: true,
            error: true,
          },
        })
        .catch(() => null);
      summary.deliveries.push({
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        delivered: fresh?.status === "SUCCEEDED",
        attempts: fresh?.attempts ?? 1,
        responseStatus: fresh?.responseStatus ?? null,
        error: fresh?.error ?? null,
      });
    }
    return summary;
  } catch (err) {
    console.warn(
      "[webhooks] dispatch failed (non-fatal):",
      (err as Error).message
    );
    return summary;
  }
}

/**
 * Fire a real `webhook.test` delivery at one endpoint immediately and return
 * the full delivery row so the admin UI can show the outcome.
 */
export async function fireTestWebhook(
  endpointId: string,
  actorLabel?: string
): Promise<{ delivered: boolean; delivery: Record<string, unknown> } | null> {
  try {
    const endpoint = await db.webhookEndpoint.findUnique({
      where: { id: endpointId },
    });
    if (!endpoint) return null;

    const body = {
      event: "webhook.test",
      occurredAt: new Date().toISOString(),
      correlationId: null,
      data: {
        message: "Citizen Lane webhook test fire",
        endpoint: endpoint.url,
        triggeredBy: actorLabel ?? "admin-console",
        sentAt: new Date().toISOString(),
      },
    };
    const rawBody = JSON.stringify(body);
    const delivery = await db.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        topic: "webhook.test",
        payload: rawBody,
        status: "PENDING",
      },
    });
    await attemptDelivery(delivery.id);
    const fresh = await db.webhookDelivery.findUnique({
      where: { id: delivery.id },
    });
    if (!fresh)
      return {
        delivered: false,
        delivery: { id: delivery.id, status: "PENDING" },
      };
    return {
      delivered: fresh.status === "SUCCEEDED",
      delivery: {
        id: fresh.id,
        topic: fresh.topic,
        status: fresh.status,
        attempts: fresh.attempts,
        responseStatus: fresh.responseStatus,
        error: fresh.error,
        lastAttemptAt: fresh.lastAttemptAt?.toISOString() ?? null,
        nextAttemptAt: fresh.nextAttemptAt?.toISOString() ?? null,
        createdAt: fresh.createdAt.toISOString(),
      },
    };
  } catch (err) {
    console.warn(
      "[webhooks] test fire failed (non-fatal):",
      (err as Error).message
    );
    return null;
  }
}

// ───────────────────────── admin reads ─────────────────────────

export type WebhookEndpointView = {
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

function parseEvents(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((e): e is string => typeof e === "string")
      : [];
  } catch {
    return [];
  }
}

/** Endpoint list for the admin console — secrets masked, per-endpoint counts. */
export async function listEndpoints(
  orgId?: string
): Promise<WebhookEndpointView[]> {
  const rows = await db.webhookEndpoint.findMany({
    where: orgId ? { orgId } : undefined,
    orderBy: { createdAt: "asc" },
  });
  const counts = await db.webhookDelivery.groupBy({
    by: ["endpointId", "status"],
    where: orgId ? { endpoint: { orgId } } : undefined,
    _count: { _all: true },
  });
  return rows.map((row) => {
    const mine = counts.filter((c) => c.endpointId === row.id);
    const pick = (status: string) =>
      mine.find((c) => c.status === status)?._count._all ?? 0;
    return {
      id: row.id,
      url: row.url,
      description: row.description,
      events: parseEvents(row.events),
      active: row.active,
      secretHint: maskSecret(row.secret),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      counts: {
        total: mine.reduce((acc, c) => acc + c._count._all, 0),
        succeeded: pick("SUCCEEDED"),
        failed: pick("FAILED"),
        pending: pick("PENDING"),
      },
    };
  });
}

export type WebhookDeliveryView = {
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

/** Delivery log, latest first. */
export async function listDeliveries(
  endpointId?: string,
  limit = 50,
  orgId?: string
): Promise<WebhookDeliveryView[]> {
  const rows = await db.webhookDelivery.findMany({
    where: {
      ...(endpointId ? { endpointId } : {}),
      ...(orgId ? { endpoint: { orgId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    endpointId: r.endpointId,
    topic: r.topic,
    status: r.status,
    attempts: r.attempts,
    responseStatus: r.responseStatus,
    error: r.error,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
  }));
}
