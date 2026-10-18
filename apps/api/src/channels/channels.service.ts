/**
 * Channels service: connected accounts, inbound ingestion, outbound send.
 *
 * Ingestion pipeline (Customermates event-dispatch discipline): verified
 * webhook -> provider.normalizeInbound -> dedupe by (provider, externalId) ->
 * persist ChannelMessage -> `channel.message.received` event into routines and
 * webhooks. Outbound sends pass through the SeldonFrame send-claim double-send
 * lock before touching a provider API.
 */

import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { InjectDatabase } from "../database/database.constants";
import { RoutinesService } from "../routines/routines.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { SendClaimService } from "../workflows/send-claim.service";
import { SuppressionService } from "../hardening/hardening-services";
import { EventDispatcherService } from "../events/event-dispatcher.service";
import { isRedelivery, messageFingerprint, type FingerprintInput } from "./message-cleaner";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";
import { IntegrationRegistryService, ProviderEnvAdapter } from "./integration-registry.service";
import {
	buildDefaultProviders,
	type FetchLike,
} from "./channel-providers";
import type {
	ChannelProvider,
	InboundChannelMessage,
	OutboundChannelMessage,
	ProviderAuthResult,
	SendResult,
} from "./channel-contracts";

const META_APP_ENV = ["META_APP_ID", "META_APP_SECRET"];
const LINKEDIN_ENV = ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"];

@Injectable()
export class ChannelsService {
	private readonly logger = new Logger(ChannelsService.name);
	private readonly providers: Map<string, ChannelProvider>;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly routines: RoutinesService,
		private readonly webhooks: WebhooksService,
		private readonly sendClaims: SendClaimService,
		private readonly registry: IntegrationRegistryService,
		private readonly suppression: SuppressionService,
		private readonly events: EventDispatcherService,
		@Optional() @Inject("CHANNELS_FETCHER") fetcher?: FetchLike,
	) {
		this.providers = buildDefaultProviders(fetcher);
		for (const id of this.providers.keys()) {
			const requiredEnv = id === "linkedin" ? LINKEDIN_ENV : META_APP_ENV;
			try {
				this.registry.register(new ProviderEnvAdapter(id, id === "linkedin" ? "tier1" : "tier1", requiredEnv));
			} catch {
				// Registry may already hold the adapter (hot reload / re-init).
			}
		}
	}

	getProvider(providerId: string): ChannelProvider {
		const provider = this.providers.get(providerId);
		if (!provider) throw new WorkflowNonRetryableError(`Unknown channel provider ${providerId}`);
		return provider;
	}

	// ------------------------------------------------------- connected accounts

	async connectAccount(ownerUserId: string, auth: ProviderAuthResult) {
		const existing = await this.db.connectedAccount.findUnique({
			where: {
				ownerUserId_provider_handle: {
					ownerUserId,
					provider: auth.provider,
					handle: auth.handle,
				},
			},
		});
		const data = {
			displayName: auth.displayName,
			status: "active" as const,
			scopes: auth.scopes,
			accessToken: auth.accessToken,
			refreshToken: auth.refreshToken,
			expiresAt: auth.expiresAt,
			metadata: auth.metadata as Prisma.InputJsonValue,
		};
		if (existing) {
			return this.db.connectedAccount.update({ where: { id: existing.id }, data });
		}
		return this.db.connectedAccount.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				provider: auth.provider,
				handle: auth.handle,
				...data,
			},
		});
	}

	async listAccounts(ownerUserId: string) {
		const accounts = await this.db.connectedAccount.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
		return accounts.map((account) => {
			const provider = this.providers.get(account.provider);
			const missing = provider ? provider.missingScopes(account.scopes) : [];
			return {
				id: account.id,
				provider: account.provider,
				handle: account.handle,
				displayName: account.displayName,
				status: account.status,
				scopes: account.scopes,
				missingScopes: missing,
				expiresAt: account.expiresAt,
			};
		});
	}

	// --------------------------------------------------------------- ingestion

	/**
	 * Idotent ingestion: per-message upsert on (provider, externalId). Returns
	 * the number of NEW messages that were persisted and dispatched.
	 */
	async ingest(ownerUserId: string, messages: InboundChannelMessage[]): Promise<number> {
		let persisted = 0;
		const recentFingerprints: Array<{ fingerprint: string; occurredAt: Date }> = [];
		for (const message of messages) {
			const existing = await this.db.channelMessage.findUnique({
				where: { provider_externalId: { provider: message.provider, externalId: message.externalId } },
			});
			if (existing) continue;

			// Message-cleaner dedupe: redeliveries of identical content within
			// the window collapse (webhook retries, reconnect storms).
			const fingerprintInput: FingerprintInput = {
				provider: message.provider,
				threadId: message.threadId,
				senderHandle: message.senderHandle,
				body: message.body,
				occurredAt: message.occurredAt,
			};
			const fingerprint = messageFingerprint(fingerprintInput);
			const redelivery =
				recentFingerprints.some((seen) => isRedelivery(fingerprintInput, seen)) ||
				(await this.recentDuplicate(fingerprint, message.occurredAt));
			if (redelivery) continue;
			recentFingerprints.push({ fingerprint, occurredAt: message.occurredAt });

			await this.db.channelMessage.create({
				data: {
					id: randomUUID(),
					ownerUserId,
					provider: message.provider,
					externalId: message.externalId,
					direction: "inbound",
					threadId: message.threadId,
					senderHandle: message.senderHandle,
					recipientHandle: message.recipientHandle,
					body: message.body,
					media: message.media as unknown as Prisma.InputJsonValue,
					raw: message.raw as Prisma.InputJsonValue,
					occurredAt: message.occurredAt,
					processedAt: new Date(),
				},
			});
			persisted += 1;

			await this.events.dispatch({
				event: "channel.message.received",
				ownerUserId,
				entityId: message.externalId,
				at: message.occurredAt,
				payload: {
					provider: message.provider,
					externalId: message.externalId,
					threadId: message.threadId,
					senderHandle: message.senderHandle,
					body: message.body,
					occurredAt: message.occurredAt.toISOString(),
				},
			});
		}
		return persisted;
	}

	// ------------------------------------------------------------------- send

	/**
	 * Outbound send guarded by the double-send lock. `idempotencyKey` is the
	 * dedupe key (callers derive it from workflow run + step, or the message
	 * intent). Exactly one attempt per key ever reaches the provider.
	 */
	async send(
		ownerUserId: string,
		providerId: string,
		message: OutboundChannelMessage,
		idempotencyKey: string,
		workflowRunId?: string,
	): Promise<{ outcome: "executed" | "skipped"; result: SendResult | null }> {
		const provider = this.getProvider(providerId);
		const suppressed = await this.suppression.isSuppressed(providerId, message.recipientHandle);
		if (suppressed) {
			throw new WorkflowNonRetryableError(
				`Recipient ${message.recipientHandle} is suppressed on ${providerId}`,
			);
		}
		const account = await this.db.connectedAccount.findFirst({
			where: {
				ownerUserId,
				provider: providerId,
				status: "active",
				...(message.metadata?.handle ? { handle: String(message.metadata.handle) } : {}),
			},
			orderBy: { createdAt: "desc" },
		});
		if (!account) throw new NotFoundException(`No active ${providerId} account for this user`);
		if (!account.accessToken) throw new WorkflowNonRetryableError(`Account ${account.id} has no access token`);

		const claim = await this.sendClaims.runWithClaim(
			{
				channel: providerId,
				kind: "channel.message",
				stepNumber: 1,
				idempotencyKey,
				ownerUserId,
				workflowRunId: workflowRunId ?? null,
			},
			async () => {
				const sent = await provider.send(
					{
						accessToken: account.accessToken as string,
						metadata: account.metadata as Record<string, unknown>,
					},
					message,
				);
				await this.db.channelMessage.create({
					data: {
						id: randomUUID(),
						connectedAccountId: account.id,
						ownerUserId,
						provider: providerId,
						externalId: sent.externalMessageId,
						direction: "outbound",
						threadId: sent.threadId,
						senderHandle: account.handle,
						recipientHandle: message.recipientHandle,
						body: message.body,
						media: (message.mediaUrls ?? []).map((url) => ({ type: "link", url })) as unknown as Prisma.InputJsonValue,
						raw: sent.raw as Prisma.InputJsonValue,
						occurredAt: new Date(),
						processedAt: new Date(),
					},
				});
				return sent;
			},
			(value) => value.externalMessageId,
		);

		if (claim.outcome === "skipped") return { outcome: "skipped", result: null };
		if (claim.outcome === "failed") {
			throw claim.error instanceof Error ? claim.error : new Error(String(claim.error));
		}
		return { outcome: "executed", result: claim.value };
	}

	// --------------------------------------------------------------- registry

	registrySnapshot(): {
		providers: Array<{ id: string; displayName: string; scopes: string[] }>;
		adapters: Array<{ id: string; tier: string }>;
		configured: string[];
	} {
		return {
			providers: [...this.providers.values()].map((provider) => ({
				id: provider.id,
				displayName: provider.displayName,
				scopes: provider.scopes,
			})),
			adapters: this.registry.getAll().map((descriptor) => ({ id: descriptor.id, tier: descriptor.tier })),
			configured: this.registry.getConfigured().map((descriptor) => descriptor.id),
		};
	}

	async health(): Promise<Array<{ id: string; ok: boolean; detail?: string }>> {
		const snapshot = await this.registry.healthCheckAll();
		return snapshot.results;
	}

	/** True when an identical content fingerprint landed within the dedupe window. */
	private async recentDuplicate(fingerprint: string, occurredAt: Date): Promise<boolean> {
		const candidates = await this.db.channelMessage.findMany({
			where: {
				occurredAt: { gte: new Date(occurredAt.getTime() - 60_000), lte: new Date(occurredAt.getTime() + 60_000) },
			},
			select: { provider: true, threadId: true, senderHandle: true, body: true, occurredAt: true },
			take: 25,
		});
		return candidates.some((row) =>
			isRedelivery(
				{
					provider: row.provider,
					threadId: row.threadId,
					senderHandle: row.senderHandle,
					body: row.body,
					occurredAt: row.occurredAt,
				},
				{ fingerprint, occurredAt },
			),
		);
	}

	/** Resolve the owner user behind a business handle for inbound routing. */
	async listAccountsByHandle(provider: string, handle: string): Promise<string | null> {
		const account = await this.db.connectedAccount.findFirst({
			where: { provider, handle },
			select: { ownerUserId: true },
		});
		return account?.ownerUserId ?? null;
	}

	async listMessages(ownerUserId: string, providerId?: string, limit = 50) {
		return this.db.channelMessage.findMany({
			where: { ownerUserId, ...(providerId ? { provider: providerId } : {}) },
			orderBy: { occurredAt: "desc" },
			take: limit,
		});
	}
}
