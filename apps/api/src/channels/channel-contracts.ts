/**
 * Channel contracts — the harmonized integration surface.
 *
 * Pattern provenance:
 *  - adapter/registry shape: SeldonFrame `IntegrationAdapter` + tiered
 *    descriptors (tier1 eager / tier2 lazy env-gated);
 *  - auth + publish lifecycle: Postiz `IAuthenticator` / `ISocialMediaIntegration`
 *    (PKCE auth, PendingCheckResponse state machine);
 *  - driver decomposition: Twenty `MessageOutboundDriver` (per-provider send
 *    drivers taking a connected account);
 *  - channel coverage (WhatsApp/Messenger/Instagram/LinkedIn): Customermates
 *    Unipile-style channel normalization.
 *
 * Everything here is framework-free so providers and the state machine can be
 * unit-tested without Nest or a database.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ------------------------------------------------------------ adapter model

export type AdapterTier = "tier1" | "tier2";

export interface ChannelAdapter {
	readonly id: string;
	readonly tier: AdapterTier;
	/** Env vars required for the adapter to be usable (tier2 lazy gating). */
	readonly requiredEnv: string[];
	isConfigured(env: NodeJS.ProcessEnv): boolean;
	healthCheck(env?: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail?: string }>;
}

export type AdapterDescriptor = {
	id: string;
	tier: AdapterTier;
	adapter: ChannelAdapter;
};

// --------------------------------------------------------- provider contract

export type ProviderAuthResult = {
	provider: string;
	externalUserId: string;
	handle: string;
	displayName: string | null;
	accessToken: string | null;
	refreshToken: string | null;
	expiresAt: Date | null;
	scopes: string[];
	metadata: Record<string, unknown>;
};

export type OutboundChannelMessage = {
	recipientHandle: string;
	body: string;
	mediaUrls?: string[];
	metadata?: Record<string, unknown>;
};

export type SendResult = {
	provider: string;
	externalMessageId: string;
	threadId: string | null;
	raw: Record<string, unknown>;
};

export type InboundChannelMessage = {
	provider: string;
	externalId: string;
	threadId: string | null;
	senderHandle: string;
	recipientHandle: string | null;
	body: string | null;
	media: Array<{ type: string; url: string }>;
	occurredAt: Date;
	raw: Record<string, unknown>;
};

/**
 * Channel provider: authenticate (PKCE-style, verifiable `state`),
 * send messages, and normalize inbound webhook payloads.
 */
export interface ChannelProvider {
	readonly id: string;
	readonly displayName: string;
	readonly scopes: string[];

	generateAuthUrl(options: { redirectUri: string; codeVerifier: string; state: string }): string;
	exchangeCode(input: {
		code: string;
		codeVerifier: string;
		redirectUri: string;
		clientId: string;
		clientSecret: string;
	}): Promise<ProviderAuthResult>;
	refresh(connected: {
		refreshToken: string;
		clientId: string;
		clientSecret: string;
	}): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }>;
	missingScopes(granted: string[]): string[];

	send(connected: {
		accessToken: string;
		metadata: Record<string, unknown>;
	}, message: OutboundChannelMessage): Promise<SendResult>;

	/** Normalize a verified webhook payload into canonical messages. */
	normalizeInbound(payload: unknown): InboundChannelMessage[];
}

// ------------------------------------------------- PKCE + state helpers (pure)

const BASE64URL_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function assertValidCodeVerifier(codeVerifier: string): void {
	if (!BASE64URL_PATTERN.test(codeVerifier)) {
		throw new Error("code_verifier must be 43-128 chars of unreserved base64url");
	}
}

export function assertValidState(state: string): void {
	if (state.length < 16) throw new Error("state must be at least 16 characters");
}

/** Scope-gap detection (Postiz `missingScopes`). */
export function missingScopes(required: string[], granted: string[]): string[] {
	const have = new Set(granted);
	return required.filter((scope) => !have.has(scope));
}

// --------------------------------------------- pending-publish state machine

export type PublishPhase = "draft" | "pending" | "ready" | "completed";

/**
 * Postiz PendingCheckResponse machine:
 *
 *   draft ──submit──▶ pending ──check:ready──▶ ready ──finalize──▶ completed
 *                        │                        │
 *                        └────check:pending───────┘ (poll again later)
 *
 * Idempotency contract (Postiz): finalize performs the publish mutations and
 * MUST resolve to `completed`; a crash after partial mutation may re-enter
 * `ready` only when every mutation is documented idempotent.
 */
export const PUBLISH_TRANSITIONS: Record<PublishPhase, Partial<Record<Extract<PublishPhase, "pending" | "ready" | "completed">, true>>> = {
	draft: { pending: true },
	pending: { pending: true, ready: true, completed: true },
	ready: { ready: true, completed: true },
	completed: { completed: true },
};

export class InvalidPublishTransition extends Error {
	constructor(from: string, to: string) {
		super(`Invalid publish transition ${from} -> ${to}`);
		this.name = "InvalidPublishTransition";
	}
}

export function assertPublishTransition(from: PublishPhase, to: PublishPhase): void {
	if (to === "draft") throw new InvalidPublishTransition(from, to);
	const allowed = PUBLISH_TRANSITIONS[from] as Record<string, true | undefined>;
	if (!allowed[to]) throw new InvalidPublishTransition(from, to);
}

export type PendingCheck = { phase: "pending" } | { phase: "ready" } | { phase: "completed" };

export function publishPhaseAfterCheck(current: PublishPhase, check: PendingCheck): PublishPhase {
	assertPublishTransition(current, check.phase);
	return check.phase;
}

// ----------------------------------------------------- webhook authenticity

/**
 * Meta (WhatsApp/Messenger/Instagram) hub signature: `sha256=` + hex
 * HMAC-SHA256 of the raw body with the app secret. Constant-time compare.
 */
export function verifyMetaSignature(params: {
	rawBody: string;
	signatureHeader: string | undefined;
	appSecret: string;
}): boolean {
	const { rawBody, signatureHeader, appSecret } = params;
	if (!signatureHeader || !appSecret) return false;
	const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(signatureHeader, "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** LinkedIn webhook signature: base64 HMAC-SHA256 of the body. */
export function verifyLinkedinSignature(params: {
	rawBody: string;
	signatureHeader: string | undefined;
	clientSecret: string;
}): boolean {
	const { rawBody, signatureHeader, clientSecret } = params;
	if (!signatureHeader || !clientSecret) return false;
	const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64");
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(signatureHeader, "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** Meta hub challenge echo (GET verification handshake). */
export function metaHubChallenge(params: {
	mode: string | undefined;
	token: string | undefined;
	verifyToken: string;
	challenge: string | undefined;
}): string | null {
	if (params.mode !== "subscribe") return null;
	if (!params.token || params.token !== params.verifyToken) return null;
	return params.challenge ?? null;
}
