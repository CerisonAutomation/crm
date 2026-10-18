import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { audit, handler } from "@/lib/api-helpers";
import { hit } from "@/lib/rate-limit";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { verifyDHLWebhookSignature, getDHLWebhookSecret } from "@/lib/adapters/dhl-real";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Prefer the provider event ID; without one, lifecycle ranking remains the fallback. */
function inboundEventId(req: NextRequest, payload: Record<string, unknown>): string | undefined {
  const value = req.headers.get("x-event-id") ?? req.headers.get("x-dhl-event-id") ?? payload.eventId;
  const trimmed = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return trimmed && trimmed.length <= 256 ? trimmed : undefined;
}

/** Every receipt is ledgered — an async, never-throwing OutboxEvent row. */
function ledger(topic: string, payload: Record<string, unknown>): void {
  db.outboxEvent
    .create({
      data: {
        topic,
        payload: JSON.stringify({ ...payload, receivedAt: new Date().toISOString() }),
        status: "PROCESSED",
        attempts: 1,
        processedAt: new Date(),
      },
    })
    .catch((err) => console.error("[webhooks/dhl] ledger failed:", err));
}

/**
 * DHL Express tracking webhook.
 *
 * Session-free BY DESIGN: DHL's servers push tracking updates and cannot hold
 * a session. Authenticated by an HMAC-SHA256 signature over the raw body
 * (`verifyDHLWebhookSignature`), rate-limited per IP, and fails CLOSED (503)
 * when no secret is configured — an unsigned callback can never mutate a
 * dispatch. Every receipt is ledgered in OutboxEvent.
 *
 * Expected payload shape:
 * {
 *   "trackingNumber": "JD014600003...",
 *   "status": "DELIVERED",
 *   "description": "Delivered — signed by AUTHORITY DESK",
 *   "timestamp": "2026-10-06T12:00:00Z",
 *   "location": { "address": { "addressLocality": "Zurich" } }
 * }
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const rawBody = await r.text();

    const ip =
      r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      r.headers.get("x-real-ip")?.trim() ||
      "unknown";

    // Per-IP abuse guard — DHL sends a handful of callbacks per shipment.
    const gate = hit(`dhl-webhook:${ip}`, 60, 3_600_000);
    if (!gate.allowed) {
      ledger("webhook.dhl.rejected", { reason: "rate_limited", ip, retryAfterSec: gate.retryAfterSec });
      return json({ error: "Rate limited" }, 429);
    }

    // Fail closed — no secret configured means no webhook is ever accepted.
    const secret = await getDHLWebhookSecret();
    if (!secret) {
      ledger("webhook.dhl.rejected", { reason: "secret_not_configured", ip });
      return json({ error: "DHL webhook secret not configured" }, 503);
    }

    const signature = r.headers.get("x-dhl-signature") ?? r.headers.get("x-signature");
    if (!verifyDHLWebhookSignature(secret, rawBody, signature)) {
      ledger("webhook.dhl.rejected", { reason: "invalid_signature", ip });
      return json({ error: "Invalid signature" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      ledger("webhook.dhl.rejected", { reason: "invalid_json", ip });
      return json({ error: "Invalid JSON body" }, 400);
    }

    const trackingId = String(payload.trackingNumber ?? "");
    if (!trackingId) {
      ledger("webhook.dhl.rejected", { reason: "missing_tracking_number", ip });
      return json({ error: "Missing trackingNumber" }, 400);
    }

    // Durable provider-event dedupe. Reserve before mutation so concurrent or
    // retried deliveries cannot emit a second state change/audit event.
    const eventId = inboundEventId(r, payload);
    const dedupeKey = eventId ? `webhook:dhl:${eventId}` : undefined;
    if (dedupeKey) {
      try {
        await db.idempotencyKey.create({ data: { key: dedupeKey, scope: "webhook-inbound" } });
      } catch {
        ledger("webhook.dhl.received", { trackingId, eventId, outcome: "duplicate" });
        return json({ ok: true, trackingId, duplicate: true });
      }
    }

    // Find the dispatch record
    const dispatch = await db.dispatch.findUnique({
      where: { trackingId },
      include: { case: { select: { id: true, reference: true, orgId: true } } },
    });

    if (!dispatch) {
      // Unknown tracking number — acknowledge but don't process.
      ledger("webhook.dhl.received", { trackingId, outcome: "unknown_tracking_number" });
      return json({ ok: true, note: "Unknown tracking number" });
    }

    // Map DHL status to internal status
    const dhlStatus = String(payload.status ?? "").toUpperCase();
    let newStatus: "DISPATCHED" | "IN_TRANSIT" | "DELIVERED" = "IN_TRANSIT";
    if (dhlStatus === "DELIVERED" || dhlStatus === "DL") {
      newStatus = "DELIVERED";
    } else if (dhlStatus === "DISPATCHED" || dhlStatus === "DP") {
      newStatus = "DISPATCHED";
    }

    // Lifecycle rank — tracking callbacks may arrive replayed or out of order,
    // so a delivered dispatch can never be moved backwards.
    const rank: Record<string, number> = { PREPARED: 0, DISPATCHED: 1, IN_TRANSIT: 2, DELIVERED: 3 };
    const currentRank = rank[dispatch.status] ?? 0;
    const nextRank = rank[newStatus] ?? 1;

    // Replay / duplicate: same status already recorded — acknowledge, ledger, and
    // stop (no second audit event, no re-emitted workflow trigger, no deliveredAt churn).
    if (nextRank === currentRank) {
      ledger("webhook.dhl.received", { trackingId, dispatchId: dispatch.id, status: dispatch.status, outcome: "duplicate" });
      return json({ ok: true, dispatchId: dispatch.id, status: dispatch.status, duplicate: true });
    }

    // Out-of-order regression (e.g. DELIVERED followed by an IN_TRANSIT ping) —
    // keep the advanced status and ledger the skip.
    if (nextRank < currentRank) {
      ledger("webhook.dhl.rejected", { trackingId, dispatchId: dispatch.id, reason: "status_regression", received: newStatus, current: dispatch.status });
      return json({ ok: true, dispatchId: dispatch.id, status: dispatch.status, ignored: "status_regression" });
    }

    // Update dispatch status inside the case's tenant context (P3 wiring):
    // under FORCE the update is denied unless the setting matches the case org.
    await withTenantContext(dispatch.case.orgId, (tx) =>
      tx.dispatch.update({
        where: { id: dispatch.id },
        data: {
          status: newStatus,
          ...(newStatus === "DELIVERED" ? { deliveredAt: new Date() } : undefined),
        },
      }),
    );

    ledger("webhook.dhl.received", { trackingId, dispatchId: dispatch.id, status: newStatus, previous: dispatch.status, ...(eventId ? { eventId } : undefined) });

    if (dedupeKey) {
      await db.idempotencyKey.update({ where: { key: dedupeKey }, data: { resultRef: dispatch.id } }).catch(() => undefined);
    }

    // Audit
    await audit({
      orgId: dispatch.case.orgId,
      action: "dispatch.tracking.updated",
      target: dispatch.case.reference,
      after: { trackingId, status: newStatus, source: "DHL webhook" },
    });

    // Emit event for workflow fan-out
    await emitCaseEvent("dispatch.tracking.updated", {
      caseId: dispatch.case.id,
      actorLabel: "DHL webhook",
      meta: {
        dispatchId: dispatch.id,
        trackingId,
        status: newStatus,
        description: String(payload.description ?? ""),
        location: payload.location ? JSON.stringify(payload.location) : null,
      },
      dedupeKey: `dhl-tracking:${dispatch.id}:${newStatus}`,
    }).catch(() => undefined);

    return json({ ok: true, dispatchId: dispatch.id, status: newStatus });
  })(req);
}
