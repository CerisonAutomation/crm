import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audit, handler } from "@/lib/api-helpers";
import { hit } from "@/lib/rate-limit";
import { documensoConfigFromEnv, isSignedEvent, verifyDocumensoWebhook } from "@/lib/signing/documenso";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

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
    .catch((err) => console.error("[webhooks/documenso] ledger failed:", err));
}

/**
 * Documenso signing webhook (E-SIGN slice, spec docs/runbooks/esign-spec.md).
 *
 * Session-free BY DESIGN: the provider's servers push signing updates and
 * cannot hold a session. Authenticated by HMAC-SHA256 over the raw body,
 * rate-limited per IP, and fails CLOSED (503) when no secret is configured —
 * an unsigned callback can never mark a letter signed. Signed events flip the
 * letter's signedAt; replays and unknown envelopes acknowledge as no-ops.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const rawBody = await r.text();

    const ip =
      r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      r.headers.get("x-real-ip")?.trim() ||
      "unknown";

    const gate = hit(`documenso-webhook:${ip}`, 60, 3_600_000);
    if (!gate.allowed) {
      ledger("webhook.documenso.rejected", { reason: "rate_limited", ip, retryAfterSec: gate.retryAfterSec });
      return json({ error: "Rate limited" }, 429);
    }

    const config = documensoConfigFromEnv();
    if (!config?.webhookSecret) {
      ledger("webhook.documenso.rejected", { reason: "secret_not_configured", ip });
      return json({ error: "Documenso webhook secret not configured" }, 503);
    }

    const signature = r.headers.get("x-documenso-signature") ?? r.headers.get("x-signature");
    if (!verifyDocumensoWebhook(config.webhookSecret, rawBody, signature)) {
      ledger("webhook.documenso.rejected", { reason: "invalid_signature", ip });
      return json({ error: "Invalid signature" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      ledger("webhook.documenso.rejected", { reason: "invalid_json", ip });
      return json({ error: "Invalid JSON body" }, 400);
    }

    const envelopeId = [payload.envelopeId, payload.documentId, payload.id]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((v) => v.length > 0 && v.length <= 256) ?? "";
    if (!envelopeId) {
      ledger("webhook.documenso.rejected", { reason: "missing_envelope_id", ip });
      return json({ error: "Missing envelope id" }, 400);
    }

    const event = payload.event ?? payload.type;
    const eventId = [payload.eventId, payload.id]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((v) => v.length > 0 && v.length <= 256);
    const dedupeKey = eventId ? `webhook:documenso:${eventId}` : undefined;
    if (dedupeKey) {
      try {
        await db.idempotencyKey.create({ data: { key: dedupeKey, scope: "webhook-inbound" } });
      } catch {
        ledger("webhook.documenso.received", { envelopeId, eventId, outcome: "duplicate" });
        return json({ ok: true, envelopeId, duplicate: true });
      }
    }

    const letter = await db.approvalLetter.findFirst({
      where: { signatureRef: envelopeId },
      include: { case: { select: { id: true, reference: true, orgId: true } } },
    });
    if (!letter) {
      ledger("webhook.documenso.received", { envelopeId, outcome: "unknown_envelope" });
      return json({ ok: true, note: "Unknown envelope" });
    }

    if (!isSignedEvent(config, event)) {
      ledger("webhook.documenso.received", { envelopeId, letterId: letter.id, outcome: "ignored_event" });
      return json({ ok: true, note: "Event ignored" });
    }
    if (letter.signedAt) {
      ledger("webhook.documenso.received", { envelopeId, letterId: letter.id, outcome: "duplicate" });
      return json({ ok: true, letterId: letter.id, duplicate: true });
    }

    const signed = await db.approvalLetter.update({
      where: { id: letter.id },
      data: { signedAt: new Date(), signatureProvider: "DOCUMENSO" },
    });
    await audit({
      orgId: letter.case.orgId,
      action: "letter.signed",
      target: letter.case.reference,
      after: { letterId: letter.id, envelopeId, signedAt: signed.signedAt },
    });
    ledger("letter.signed", { letterId: letter.id, envelopeId, caseRef: letter.case.reference });
    return json({ ok: true, letterId: letter.id, signed: true });
  })(req);
}
