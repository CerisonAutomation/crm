/**
 * Send claims — the double-send lock (pattern harvested from SeldonFrame
 * `replay-send-claims` / "Replay gate v2").
 *
 * Contract:
 *  - `claim()` INSERTs BEFORE any destructive outbound call; the UNIQUE
 *    (channel, kind, stepNumber, idempotencyKey) index IS the lock — a
 *    concurrent second INSERT loses with P2002 and must NOT execute;
 *  - the claim row is created with outcome `unknown`, then resolved to
 *    `sent` (provider accepted) or `failed` (provider threw);
 *  - asymmetric divergence policy: a `failed` claim STAYS, so retries never
 *    re-attempt an ambiguous send; `unknown` means the process died between
 *    claim and resolution and must be reconciled manually, never blindly re-run.
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Db, SendClaimModel } from "@crm/db";

type SendClaim = SendClaimModel;
import { InjectDatabase } from "../database/database.constants";

export type ClaimKey = {
	channel: string;
	kind: string;
	stepNumber: number;
	idempotencyKey: string;
	ownerUserId?: string | null;
	workflowRunId?: string | null;
};

export type ClaimResult =
	| { outcome: "claimed"; claim: SendClaim }
	| { outcome: "already-claimed"; claim: SendClaim | null };

export type RunWithClaimResult<T> =
	| { outcome: "executed"; value: T; claim: SendClaim }
	| { outcome: "skipped"; claim: SendClaim | null }
	| { outcome: "failed"; error: unknown; claim: SendClaim };

@Injectable()
export class SendClaimService {
	private readonly logger = new Logger(SendClaimService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * Attempts to acquire the send lock. Returns `claimed` when this caller
	 * won the UNIQUE-insert race and MUST perform the send; `already-claimed`
	 * when any prior attempt holds the key (whatever its outcome).
	 */
	async claim(key: ClaimKey): Promise<ClaimResult> {
		const existing = await this.db.sendClaim.findUnique({
			where: {
				channel_kind_stepNumber_idempotencyKey: {
					channel: key.channel,
					kind: key.kind,
					stepNumber: key.stepNumber,
					idempotencyKey: key.idempotencyKey,
				},
			},
		});
		if (existing) return { outcome: "already-claimed", claim: existing };

		try {
			const claim = await this.db.sendClaim.create({
				data: {
					id: randomUUID(),
					ownerUserId: key.ownerUserId ?? null,
					workflowRunId: key.workflowRunId ?? null,
					channel: key.channel,
					kind: key.kind,
					stepNumber: key.stepNumber,
					idempotencyKey: key.idempotencyKey,
					outcome: "unknown",
				},
			});
			return { outcome: "claimed", claim };
		} catch (error) {
			// Unique-violation: a concurrent caller won the race between our
			// findUnique and create. That is a normal contended outcome.
			if (isUniqueViolation(error)) {
				const winner = await this.db.sendClaim.findUnique({
					where: {
						channel_kind_stepNumber_idempotencyKey: {
							channel: key.channel,
							kind: key.kind,
							stepNumber: key.stepNumber,
							idempotencyKey: key.idempotencyKey,
						},
					},
				});
				return { outcome: "already-claimed", claim: winner };
			}
			throw error;
		}
	}

	async markSent(claimId: string, providerReference?: string | null): Promise<void> {
		await this.db.sendClaim.updateMany({
			where: { id: claimId },
			data: {
				outcome: "sent",
				providerReference: providerReference ?? null,
				resolvedAt: new Date(),
				lastError: null,
			},
		});
	}

	async markFailed(claimId: string, error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		await this.db.sendClaim.updateMany({
			where: { id: claimId },
			data: {
				outcome: "failed",
				resolvedAt: new Date(),
				lastError: message.slice(0, 2000),
			},
		});
	}

	/**
	 * Claim → run → resolve wrapper. The destructive body only executes when
	 * the claim is won; failures leave a `failed` claim behind (asymmetric
	 * policy) and are rethrown so the workflow can apply its retry taxonomy.
	 */
	async runWithClaim<T>(key: ClaimKey, body: () => Promise<T>, referenceOf?: (value: T) => string | null): Promise<RunWithClaimResult<T>> {
		const acquisition = await this.claim(key);
		if (acquisition.outcome === "already-claimed") {
			this.logger.warn(`Send skipped: ${key.channel}/${key.kind}/${key.idempotencyKey} already claimed`);
			return { outcome: "skipped", claim: acquisition.claim };
		}

		const claim = acquisition.claim;
		try {
			const value = await body();
			await this.markSent(claim.id, referenceOf ? referenceOf(value) : null);
			return { outcome: "executed", value, claim };
		} catch (error) {
			await this.markFailed(claim.id, error);
			return { outcome: "failed", error, claim };
		}
	}

	/** Claims stuck in `unknown` (process died mid-send) — ops reconciliation. */
	async unresolvedClaims(limit = 100): Promise<SendClaim[]> {
		return this.db.sendClaim.findMany({
			where: { outcome: "unknown" },
			orderBy: { claimedAt: "asc" },
			take: limit,
		});
	}

	async claimById(claimId: string): Promise<SendClaim | null> {
		return this.db.sendClaim.findUnique({ where: { id: claimId } });
	}
}

function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const candidate = error as { code?: unknown; meta?: unknown; message?: unknown };
	if (candidate.code === "P2002") return true;
	const message = typeof candidate.message === "string" ? candidate.message : "";
	return message.includes("23505") || message.toLowerCase().includes("unique constraint");
}
