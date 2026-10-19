/**
 * Channel providers: WhatsApp Cloud, Messenger, Instagram Messaging and
 * LinkedIn Messaging.
 *
 * Real endpoints and payload shapes (Meta Graph v21.0 + LinkedIn REST),
 * implemented over an injectable `fetch` so unit tests exercise request
 * building and normalization without network I/O. WhatsApp/Messenger/Instagram
 * share the Meta Graph surface and are built from one base class — the same
 * decomposition Twenty uses for message-import drivers.
 */

import type {
	ChannelProvider,
	InboundChannelMessage,
	OutboundChannelMessage,
	ProviderAuthResult,
	SendResult,
} from "./channel-contracts";
import {
	assertValidCodeVerifier,
	assertValidState,
	missingScopes,
} from "./channel-contracts";

export type FetchLike = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	},
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

type TokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
};

const GRAPH = "https://graph.facebook.com/v21.0";

abstract class MetaChannelProvider implements ChannelProvider {
	abstract readonly id: string;
	abstract readonly displayName: string;
	abstract readonly scopes: string[];

	protected constructor(
		protected readonly graphBase: string,
		protected readonly fetcher: FetchLike,
	) {}

	generateAuthUrl(options: {
		redirectUri: string;
		codeVerifier: string;
		state: string;
	}): string {
		assertValidCodeVerifier(options.codeVerifier);
		assertValidState(options.state);
		const params = new URLSearchParams({
			client_id: "__CLIENT_ID__",
			redirect_uri: options.redirectUri,
			scope: this.scopes.join(","),
			response_type: "code",
			state: options.state,
			code_challenge_method: "S256",
		});
		return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
	}

	async exchangeCode(input: {
		code: string;
		codeVerifier: string;
		redirectUri: string;
		clientId: string;
		clientSecret: string;
	}): Promise<ProviderAuthResult> {
		assertValidCodeVerifier(input.codeVerifier);

		const tokenUrl = new URL(`${this.graphBase}/oauth/access_token`);
		tokenUrl.searchParams.set("client_id", input.clientId);
		tokenUrl.searchParams.set("client_secret", input.clientSecret);
		tokenUrl.searchParams.set("redirect_uri", input.redirectUri);
		tokenUrl.searchParams.set("code", input.code);

		const tokenResponse = await this.fetcher(tokenUrl.toString(), {
			method: "GET",
			headers: { accept: "application/json" },
		});
		if (!tokenResponse.ok) {
			throw new Error(
				`${this.id} token exchange failed with status ${tokenResponse.status}`,
			);
		}
		const token = (await tokenResponse.json()) as TokenResponse;
		if (!token.access_token)
			throw new Error(`${this.id} token exchange returned no access_token`);

		return this.hydrateIdentity(token, input.codeVerifier);
	}

	/** Exchange a long-lived token for the business identity behind it. */
	protected abstract hydrateIdentity(
		token: TokenResponse,
		codeVerifier: string,
	): Promise<ProviderAuthResult>;

	async refresh(connected: {
		refreshToken: string;
		clientId: string;
		clientSecret: string;
	}): Promise<{
		accessToken: string;
		refreshToken: string | null;
		expiresAt: Date | null;
	}> {
		const url = new URL(`${this.graphBase}/oauth/access_token`);
		url.searchParams.set("grant_type", "fb_exchange_token");
		url.searchParams.set("client_id", connected.clientId);
		url.searchParams.set("client_secret", connected.clientSecret);
		url.searchParams.set("fb_exchange_token", connected.refreshToken);

		const response = await this.fetcher(url.toString(), {
			method: "GET",
			headers: { accept: "application/json" },
		});
		if (!response.ok)
			throw new Error(
				`${this.id} refresh failed with status ${response.status}`,
			);
		const token = (await response.json()) as TokenResponse;
		if (!token.access_token)
			throw new Error(`${this.id} refresh returned no access_token`);
		return {
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? null,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000)
				: null,
		};
	}

	missingScopes(granted: string[]): string[] {
		return missingScopes(this.scopes, granted);
	}

	abstract send(
		connected: {
			accessToken: string;
			metadata: Record<string, unknown>;
		},
		message: OutboundChannelMessage,
	): Promise<SendResult>;

	abstract normalizeInbound(payload: unknown): InboundChannelMessage[];

	protected async postGraph(
		path: string,
		accessToken: string,
		body: Record<string, unknown>,
	): Promise<SendResult> {
		const response = await this.fetcher(`${this.graphBase}${path}`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
		const raw = (await response.json()) as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(
				`${this.id} send failed with status ${response.status}: ${JSON.stringify(raw)}`,
			);
		}
		const externalMessageId =
			typeof raw.message_id === "string"
				? raw.message_id
				: typeof raw.id === "string"
					? raw.id
					: "";
		if (!externalMessageId)
			throw new Error(`${this.id} send returned no message id`);
		return {
			provider: this.id,
			externalMessageId,
			threadId: typeof raw.thread_id === "string" ? raw.thread_id : null,
			raw,
		};
	}
}

type MessagingEntry = {
	id?: string;
	time?: number;
	messaging?: Array<{
		sender?: { id?: string };
		recipient?: { id?: string };
		timestamp?: number;
		message?: {
			mid?: string;
			text?: string;
			attachments?: Array<{ type?: string; payload?: { url?: string } }>;
		};
	}>;
};

function normalizeMessagingWebhook(
	provider: string,
	payload: unknown,
): InboundChannelMessage[] {
	const body = payload as { entry?: MessagingEntry[] };
	const messages: InboundChannelMessage[] = [];
	for (const entry of body.entry ?? []) {
		for (const event of entry.messaging ?? []) {
			const mid = event.message?.mid;
			if (!mid) continue;
			messages.push({
				provider,
				externalId: mid,
				threadId: event.sender?.id ?? entry.id ?? null,
				senderHandle: event.sender?.id ?? "unknown",
				recipientHandle: event.recipient?.id ?? null,
				body: event.message?.text ?? null,
				media: (event.message?.attachments ?? []).map((attachment) => ({
					type: attachment.type ?? "unknown",
					url: attachment.payload?.url ?? "",
				})),
				occurredAt: new Date(event.timestamp ?? entry.time ?? Date.now()),
				raw: event as Record<string, unknown>,
			});
		}
	}
	return messages;
}

// ------------------------------------------------------------------ WhatsApp

export class WhatsAppChannelProvider extends MetaChannelProvider {
	readonly id = "whatsapp";
	readonly displayName = "WhatsApp Business";
	readonly scopes = [
		"whatsapp_business_messaging",
		"whatsapp_business_management",
	];

	constructor(fetcher: FetchLike = globalThis.fetch as FetchLike) {
		super(GRAPH, fetcher);
	}

	protected async hydrateIdentity(
		token: TokenResponse,
		_codeVerifier: string,
	): Promise<ProviderAuthResult> {
		const response = await this.fetcher(`${GRAPH}/me?fields=id,name`, {
			headers: { authorization: `Bearer ${token.access_token ?? ""}` },
		});
		const me = (await response.json()) as { id?: string; name?: string };
		return {
			provider: this.id,
			externalUserId: me.id ?? "unknown",
			handle: me.id ?? "unknown",
			displayName: me.name ?? null,
			accessToken: token.access_token ?? null,
			refreshToken: token.refresh_token ?? null,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000)
				: null,
			scopes: (token.scope ?? "").split(",").filter(Boolean),
			metadata: {},
		};
	}

	async send(
		connected: {
			accessToken: string;
			metadata: Record<string, unknown>;
		},
		message: OutboundChannelMessage,
	): Promise<SendResult> {
		const phoneNumberId = String(connected.metadata.phoneNumberId ?? "");
		if (!phoneNumberId)
			throw new Error("whatsapp send requires metadata.phoneNumberId");
		return this.postGraph(`/${phoneNumberId}/messages`, connected.accessToken, {
			messaging_product: "whatsapp",
			to: message.recipientHandle,
			type: message.body ? "text" : "image",
			...(message.body
				? { text: { body: message.body } }
				: { image: { link: message.mediaUrls?.[0] ?? "" } }),
		});
	}

	normalizeInbound(payload: unknown): InboundChannelMessage[] {
		return normalizeMessagingWebhook(this.id, payload);
	}
}

// ----------------------------------------------------------------- Messenger

export class MessengerChannelProvider extends MetaChannelProvider {
	readonly id = "messenger";
	readonly displayName = "Facebook Messenger";
	readonly scopes = ["pages_messaging", "pages_manage_metadata"];

	constructor(fetcher: FetchLike = globalThis.fetch as FetchLike) {
		super(GRAPH, fetcher);
	}

	protected async hydrateIdentity(
		token: TokenResponse,
		_codeVerifier: string,
	): Promise<ProviderAuthResult> {
		const response = await this.fetcher(
			`${GRAPH}/me/accounts?fields=id,name,access_token`,
			{
				headers: { authorization: `Bearer ${token.access_token ?? ""}` },
			},
		);
		const pages =
			(
				(await response.json()) as {
					data?: Array<{ id?: string; name?: string; access_token?: string }>;
				}
			).data ?? [];
		const page = pages[0];
		return {
			provider: this.id,
			externalUserId: page?.id ?? "unknown",
			handle: page?.id ?? "unknown",
			displayName: page?.name ?? null,
			accessToken: page?.access_token ?? token.access_token ?? null,
			refreshToken: token.refresh_token ?? null,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000)
				: null,
			scopes: (token.scope ?? "").split(",").filter(Boolean),
			metadata: { pageId: page?.id ?? null },
		};
	}

	async send(
		connected: {
			accessToken: string;
			metadata: Record<string, unknown>;
		},
		message: OutboundChannelMessage,
	): Promise<SendResult> {
		return this.postGraph("/me/messages", connected.accessToken, {
			recipient: { id: message.recipientHandle },
			message: {
				text: message.body,
				attachment: message.mediaUrls?.length
					? {
							type: "image" as const,
							payload: { url: message.mediaUrls[0] },
						}
					: undefined,
			},
		});
	}

	normalizeInbound(payload: unknown): InboundChannelMessage[] {
		return normalizeMessagingWebhook(this.id, payload);
	}
}

// ----------------------------------------------------------------- Instagram

export class InstagramChannelProvider extends MetaChannelProvider {
	readonly id = "instagram";
	readonly displayName = "Instagram Messaging";
	readonly scopes = ["instagram_manage_messages", "pages_manage_metadata"];

	constructor(fetcher: FetchLike = globalThis.fetch as FetchLike) {
		super(GRAPH, fetcher);
	}

	protected async hydrateIdentity(
		token: TokenResponse,
		_codeVerifier: string,
	): Promise<ProviderAuthResult> {
		const response = await this.fetcher(`${GRAPH}/me?fields=id,username`, {
			headers: { authorization: `Bearer ${token.access_token ?? ""}` },
		});
		const me = (await response.json()) as { id?: string; username?: string };
		return {
			provider: this.id,
			externalUserId: me.id ?? "unknown",
			handle: me.username ?? me.id ?? "unknown",
			displayName: me.username ?? null,
			accessToken: token.access_token ?? null,
			refreshToken: token.refresh_token ?? null,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000)
				: null,
			scopes: (token.scope ?? "").split(",").filter(Boolean),
			metadata: { igUserId: me.id ?? null },
		};
	}

	async send(
		connected: {
			accessToken: string;
			metadata: Record<string, unknown>;
		},
		message: OutboundChannelMessage,
	): Promise<SendResult> {
		const igUserId = String(connected.metadata.igUserId ?? "");
		if (!igUserId) throw new Error("instagram send requires metadata.igUserId");
		return this.postGraph(`/${igUserId}/messages`, connected.accessToken, {
			recipient: { id: message.recipientHandle },
			message: { text: message.body },
		});
	}

	normalizeInbound(payload: unknown): InboundChannelMessage[] {
		return normalizeMessagingWebhook(this.id, payload);
	}
}

// ------------------------------------------------------------------- LinkedIn

const LINKEDIN_API = "https://api.linkedin.com/rest";

export class LinkedInChannelProvider implements ChannelProvider {
	readonly id = "linkedin";
	readonly displayName = "LinkedIn Messaging";
	readonly scopes = [
		"w_member_social",
		"r_basicprofile",
		"w_organization_social",
	];

	constructor(
		private readonly fetcher: FetchLike = globalThis.fetch as FetchLike,
	) {}

	generateAuthUrl(options: {
		redirectUri: string;
		codeVerifier: string;
		state: string;
	}): string {
		assertValidCodeVerifier(options.codeVerifier);
		assertValidState(options.state);
		const params = new URLSearchParams({
			response_type: "code",
			client_id: "__CLIENT_ID__",
			redirect_uri: options.redirectUri,
			state: options.state,
			scope: this.scopes.join(" "),
			code_challenge: options.codeVerifier,
			code_challenge_method: "S256",
		});
		return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
	}

	async exchangeCode(input: {
		code: string;
		codeVerifier: string;
		redirectUri: string;
		clientId: string;
		clientSecret: string;
	}): Promise<ProviderAuthResult> {
		assertValidCodeVerifier(input.codeVerifier);
		const response = await this.fetcher(
			"https://www.linkedin.com/oauth/v2/accessToken",
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code: input.code,
					redirect_uri: input.redirectUri,
					client_id: input.clientId,
					client_secret: input.clientSecret,
					code_verifier: input.codeVerifier,
				}).toString(),
			},
		);
		if (!response.ok)
			throw new Error(
				`linkedin token exchange failed with status ${response.status}`,
			);
		const token = (await response.json()) as TokenResponse;
		if (!token.access_token)
			throw new Error("linkedin token exchange returned no access_token");

		const profileResponse = await this.fetcher(
			"https://api.linkedin.com/v2/userinfo",
			{
				headers: { authorization: `Bearer ${token.access_token}` },
			},
		);
		const profile = (await profileResponse.json()) as {
			sub?: string;
			name?: string;
			given_name?: string;
		};

		return {
			provider: this.id,
			externalUserId: profile.sub ?? "unknown",
			handle: profile.sub ?? "unknown",
			displayName: profile.name ?? profile.given_name ?? null,
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? null,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000)
				: null,
			scopes: (token.scope ?? "").split(" ").filter(Boolean),
			metadata: {},
		};
	}

	async refresh(connected: {
		refreshToken: string;
		clientId: string;
		clientSecret: string;
	}): Promise<{
		accessToken: string;
		refreshToken: string | null;
		expiresAt: Date | null;
	}> {
		const response = await this.fetcher(
			"https://www.linkedin.com/oauth/v2/accessToken",
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: connected.refreshToken,
					client_id: connected.clientId,
					client_secret: connected.clientSecret,
				}).toString(),
			},
		);
		if (!response.ok)
			throw new Error(`linkedin refresh failed with status ${response.status}`);
		const token = (await response.json()) as TokenResponse;
		if (!token.access_token)
			throw new Error("linkedin refresh returned no access_token");
		return {
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? connected.refreshToken,
			expiresAt: token.expires_in
				? new Date(Date.now() + token.expires_in * 1000)
				: null,
		};
	}

	missingScopes(granted: string[]): string[] {
		return missingScopes(this.scopes, granted);
	}

	async send(
		connected: {
			accessToken: string;
			metadata: Record<string, unknown>;
		},
		message: OutboundChannelMessage,
	): Promise<SendResult> {
		const response = await this.fetcher(`${LINKEDIN_API}/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${connected.accessToken}`,
				"content-type": "application/json",
				"linkedin-version": "202509",
				"x-restli-protocol-version": "action",
			},
			body: JSON.stringify({
				recipients: [message.recipientHandle],
				subject: message.metadata?.subject ?? "Message",
				body: message.body,
				attachments: (message.mediaUrls ?? []).map((url) => ({
					type: "LINK",
					url,
				})),
			}),
		});
		const raw = (await response.json()) as Record<string, unknown>;
		if (!response.ok) {
			throw new Error(
				`linkedin send failed with status ${response.status}: ${JSON.stringify(raw)}`,
			);
		}
		const externalMessageId =
			typeof raw.id === "string" ? raw.id : `linkedin-${Date.now()}`;
		return { provider: this.id, externalMessageId, threadId: null, raw };
	}

	normalizeInbound(payload: unknown): InboundChannelMessage[] {
		const body = payload as {
			value?: Array<{
				id?: string;
				from?: string;
				to?: string[];
				body?: string;
				sentAt?: number;
				conversationId?: string;
			}>;
		};
		return (body.value ?? []).map((event) => ({
			provider: this.id,
			externalId: event.id ?? `linkedin-${event.sentAt ?? 0}`,
			threadId: event.conversationId ?? null,
			senderHandle: event.from ?? "unknown",
			recipientHandle: event.to?.[0] ?? null,
			body: event.body ?? null,
			media: [],
			occurredAt: new Date(event.sentAt ?? Date.now()),
			raw: event as Record<string, unknown>,
		}));
	}
}

/** Factory used by the registry and controller. */
export function buildDefaultProviders(
	fetcher?: FetchLike,
): Map<string, ChannelProvider> {
	const fetchImpl = fetcher ?? (globalThis.fetch as FetchLike);
	const providers: ChannelProvider[] = [
		new WhatsAppChannelProvider(fetchImpl),
		new MessengerChannelProvider(fetchImpl),
		new InstagramChannelProvider(fetchImpl),
		new LinkedInChannelProvider(fetchImpl),
	];
	return new Map(providers.map((provider) => [provider.id, provider]));
}
