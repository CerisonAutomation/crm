/**
 * Channels controller: provider webhooks (with authenticity verification),
 * OAuth code exchange, connected-account listing and guarded outbound send.
 */

import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Headers,
	HttpCode,
	NotFoundException,
	Param,
	Post,
	Query,
	Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { auth } from "@crm/auth";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { ChannelsService } from "./channels.service";
import {
	metaHubChallenge,
	verifyLinkedinSignature,
	verifyMetaSignature,
} from "./channel-contracts";

type CrmSession = UserSession<typeof auth>;

const META_PROVIDERS = new Set(["whatsapp", "messenger", "instagram"]);

@ApiTags("Channels")
@Controller("api/channels")
export class ChannelsController {
	constructor(private readonly channels: ChannelsService) {}

	// ------------------------------------------------------------ webhooks

	@Get(":provider/inbound")
	@ApiOperation({ summary: "Meta hub verification handshake" })
	hubChallenge(
		@Param("provider") provider: string,
		@Query("hub.mode") mode?: string,
		@Query("hub.verify_token") token?: string,
		@Query("hub.challenge") challenge?: string,
	) {
		if (!META_PROVIDERS.has(provider)) throw new NotFoundException("Unknown provider");
		const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
		const echoed = metaHubChallenge({ mode, token, verifyToken, challenge });
		if (echoed === null) throw new BadRequestException("hub verification failed");
		return echoed;
	}

	@Post(":provider/inbound")
	@HttpCode(200)
	@ApiOperation({ summary: "Provider inbound webhook (signature-verified)" })
	async inbound(
		@Param("provider") provider: string,
		@Req() req: RawBodyRequest<Request>,
		@Body() body: unknown,
		@Headers() headers: Record<string, string | undefined>,
	): Promise<{ received: number }> {
		const rawBody = req.rawBody
			? req.rawBody.toString("utf8")
			: JSON.stringify(body);

		if (META_PROVIDERS.has(provider)) {
			const appSecret = process.env.META_APP_SECRET ?? "";
			const ok = verifyMetaSignature({
				rawBody,
				signatureHeader: headers["x-hub-signature-256"],
				appSecret,
			});
			if (!ok) throw new BadRequestException("invalid meta signature");
		} else if (provider === "linkedin") {
			const ok = verifyLinkedinSignature({
				rawBody,
				signatureHeader: headers["x-linkedin-signature"],
				clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
			});
			if (!ok) throw new BadRequestException("invalid linkedin signature");
		} else {
			throw new NotFoundException("Unknown provider");
		}

		const providerImpl = this.channels.getProvider(provider);
		const messages = providerImpl.normalizeInbound(body);

		// Webhooks carry page-scoped identities; the owner resolution maps the
		// recipient (business) handle to its connected account.
		let received = 0;
		for (const message of messages) {
			const ownerUserId = await this.resolveOwner(provider, message.recipientHandle ?? message.senderHandle);
			if (!ownerUserId) continue;
			received += await this.channels.ingest(ownerUserId, [message]);
		}
		return { received };
	}

	// --------------------------------------------------------------- auth

	@Post(":provider/connect")
	@ApiOperation({ summary: "Exchange an OAuth code and connect an account" })
	async connect(
		@Session() session: CrmSession,
		@Param("provider") provider: string,
		@Body() body: { code: string; codeVerifier: string; redirectUri: string },
	) {
		const providerImpl = this.channels.getProvider(provider);
		const result = await providerImpl.exchangeCode({
			code: body.code,
			codeVerifier: body.codeVerifier,
			redirectUri: body.redirectUri,
			clientId: this.clientIdFor(provider),
			clientSecret: this.clientSecretFor(provider),
		});
		const account = await this.channels.connectAccount(session.user.id, result);
		return {
			account: {
				id: account.id,
				provider: account.provider,
				handle: account.handle,
				displayName: account.displayName,
				status: account.status,
			},
		};
	}

	@Get("accounts")
	@ApiOperation({ summary: "List connected accounts with scope gaps" })
	async accounts(@Session() session: CrmSession) {
		return { accounts: await this.channels.listAccounts(session.user.id) };
	}

	// ---------------------------------------------------------------- send

	@Post(":provider/send")
	@ApiOperation({ summary: "Send a channel message (double-send-lock guarded)" })
	async send(
		@Session() session: CrmSession,
		@Param("provider") provider: string,
		@Body() body: {
			recipientHandle: string;
			body: string;
			mediaUrls?: string[];
			idempotencyKey: string;
			handle?: string;
		},
	) {
		if (!body.idempotencyKey || body.idempotencyKey.trim().length === 0) {
			throw new BadRequestException("idempotencyKey is required");
		}
		const result = await this.channels.send(
			session.user.id,
			provider,
			{
				recipientHandle: body.recipientHandle,
				body: body.body,
				mediaUrls: body.mediaUrls ?? [],
				metadata: body.handle ? { handle: body.handle } : {},
			},
			body.idempotencyKey,
		);
		return result;
	}

	@Get("messages")
	@ApiOperation({ summary: "List recent channel messages" })
	async messages(
		@Session() session: CrmSession,
		@Query("provider") provider?: string,
		@Query("limit") limit?: string,
	) {
		const take = limit ? Number(limit) : 50;
		return {
			messages: await this.channels.listMessages(
				session.user.id,
				provider,
				Number.isFinite(take) && take > 0 && take <= 200 ? take : 50,
			),
		};
	}

	@Get("registry")
	@ApiOperation({ summary: "Integration registry snapshot (tiered adapters)" })
	registry() {
		return this.channels.registrySnapshot();
	}

	// ------------------------------------------------------------- helpers

	private async resolveOwner(provider: string, handle: string): Promise<string | null> {
		const account = await this.channels
			.listAccountsByHandle(provider, handle)
			.catch(() => null);
		return account;
	}

	private clientIdFor(provider: string): string {
		return provider === "linkedin"
			? (process.env.LINKEDIN_CLIENT_ID ?? "")
			: (process.env.META_APP_ID ?? "");
	}

	private clientSecretFor(provider: string): string {
		return provider === "linkedin"
			? (process.env.LINKEDIN_CLIENT_SECRET ?? "")
			: (process.env.META_APP_SECRET ?? "");
	}
}
