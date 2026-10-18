/**
 * HMAC-SHA256 webhook signing (extracted from Customermates
 * `DeliverWebhookInteractor.signWebhookPayload`). The signature is the hex
 * HMAC of the exact request body, delivered in `X-Webhook-Signature`.
 * Receivers (n8n, Zapier, custom services) verify with the shared secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

export function signWebhookPayload(secret: string, rawBody: string): string {
	return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyWebhookSignature(
	secret: string,
	rawBody: string,
	signature: string,
): boolean {
	const expected = signWebhookPayload(secret, rawBody);
	if (expected.length !== signature.length) return false;
	return timingSafeEqual(
		Buffer.from(expected, "utf8"),
		Buffer.from(signature, "utf8"),
	);
}
