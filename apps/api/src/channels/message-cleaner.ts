/**
 * Message cleaner (pattern harvested from Twenty `message-cleaner`): inbound
 * ingestion dedupe beyond the provider id — repeated deliveries of the same
 * content (webhook retries, reconnect storms) collapse within a time window
 * by content fingerprint.
 */

import { createHash } from "node:crypto";

export type FingerprintInput = {
	provider: string;
	threadId: string | null;
	senderHandle: string;
	body: string | null;
	occurredAt: Date;
};

/** Window within which identical content is treated as a redelivery. */
export const DEDUPE_WINDOW_MS = 60_000;

export function messageFingerprint(input: FingerprintInput): string {
	const normalized = [
		input.provider,
		input.threadId ?? "",
		input.senderHandle.trim().toLowerCase(),
		(input.body ?? "").trim(),
	].join("\n");
	return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function isRedelivery(
	a: FingerprintInput,
	b: { fingerprint: string; occurredAt: Date },
	windowMs = DEDUPE_WINDOW_MS,
): boolean {
	if (messageFingerprint(a) !== b.fingerprint) return false;
	return Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) <= windowMs;
}
