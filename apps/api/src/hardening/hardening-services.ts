/**
 * Workspace hardening services (pattern harvested from SeldonFrame U8:
 * workspace-secrets, workspace-domains, portal-access-codes, suppression-list).
 *
 *  - WorkspaceSecretsService — AES-256-GCM vault; plaintext never leaves the
 *    service (`reveal` is the single gated accessor), API surfaces expose
 *    metadata only. Key comes from WORKSPACE_SECRETS_KEY (base64, 32 bytes).
 *  - PortalAccessService — hashed access codes (sha256), bounded uses with a
 *    compare-and-swap consume, expiry and revocation.
 *  - WorkspaceDomainsService — custom domains with a DNS verification token
 *    (white-label URLs).
 *  - SuppressionService — per-channel do-not-contact list (idempotent add).
 */

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import type { Db } from "@crm/db";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

// ------------------------------------------------------------ pure helpers

export type SealedSecret = {
	ciphertext: string;
	iv: string;
	authTag: string;
	keyVersion: number;
};

export function loadVaultKey(env: NodeJS.ProcessEnv = process.env): Buffer {
	const raw = env.WORKSPACE_SECRETS_KEY ?? "";
	if (raw.length === 0) {
		throw new WorkflowNonRetryableError(
			"WORKSPACE_SECRETS_KEY is not configured",
		);
	}
	const key = Buffer.from(raw, "base64");
	if (key.length !== 32) {
		throw new WorkflowNonRetryableError(
			"WORKSPACE_SECRETS_KEY must decode to exactly 32 bytes",
		);
	}
	return key;
}

export function sealSecret(
	plaintext: string,
	key: Buffer,
	keyVersion = 1,
): SealedSecret {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return {
		ciphertext: encrypted.toString("base64"),
		iv: iv.toString("base64"),
		authTag: cipher.getAuthTag().toString("base64"),
		keyVersion,
	};
}

export function openSecret(sealed: SealedSecret, key: Buffer): string {
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(sealed.iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
	return Buffer.concat([
		decipher.update(Buffer.from(sealed.ciphertext, "base64")),
		decipher.final(),
	]).toString("utf8");
}

export function hashCode(code: string): string {
	return createHash("sha256").update(code, "utf8").digest("hex");
}

const DOMAIN_PATTERN =
	/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isValidDomain(domain: string): boolean {
	return DOMAIN_PATTERN.test(domain.trim().toLowerCase());
}

export function constantTimeHexEqual(a: string, b: string): boolean {
	const left = Buffer.from(a, "utf8");
	const right = Buffer.from(b, "utf8");
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

// ----------------------------------------------------------- secret vault

export type SecretMetadata = {
	id: string;
	name: string;
	keyVersion: number;
	lastRotatedAt: Date | null;
	createdAt: Date;
};

@Injectable()
export class WorkspaceSecretsService {
	private vaultKey: Buffer | null;

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Optional() @Inject("VAULT_KEY_BUFFER") vaultKey?: Buffer,
	) {
		this.vaultKey = vaultKey ?? null;
	}

	private key(): Buffer {
		if (!this.vaultKey) this.vaultKey = loadVaultKey();
		return this.vaultKey;
	}

	async put(
		ownerUserId: string,
		name: string,
		plaintext: string,
	): Promise<SecretMetadata> {
		if (name.trim().length === 0)
			throw new WorkflowNonRetryableError("secret name is required");
		const sealed = sealSecret(plaintext, this.key());
		const row = await this.db.workspaceSecret.upsert({
			where: { ownerUserId_name: { ownerUserId, name } },
			create: {
				id: randomUUID(),
				ownerUserId,
				name,
				ciphertext: sealed.ciphertext,
				iv: sealed.iv,
				authTag: sealed.authTag,
				keyVersion: sealed.keyVersion,
			},
			update: {
				ciphertext: sealed.ciphertext,
				iv: sealed.iv,
				authTag: sealed.authTag,
				keyVersion: sealed.keyVersion,
				lastRotatedAt: new Date(),
			},
		});
		return {
			id: row.id,
			name: row.name,
			keyVersion: row.keyVersion,
			lastRotatedAt: row.lastRotatedAt,
			createdAt: row.createdAt,
		};
	}

	async metadata(ownerUserId: string): Promise<SecretMetadata[]> {
		const rows = await this.db.workspaceSecret.findMany({
			where: { ownerUserId },
			orderBy: { name: "asc" },
		});
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			keyVersion: row.keyVersion,
			lastRotatedAt: row.lastRotatedAt,
			createdAt: row.createdAt,
		}));
	}

	/** Single gated plaintext accessor — for internal wiring, never HTTP. */
	async reveal(ownerUserId: string, name: string): Promise<string> {
		const row = await this.db.workspaceSecret.findUnique({
			where: { ownerUserId_name: { ownerUserId, name } },
		});
		if (!row) throw new WorkflowNonRetryableError(`No secret ${name}`);
		return openSecret(
			{
				ciphertext: row.ciphertext,
				iv: row.iv,
				authTag: row.authTag,
				keyVersion: row.keyVersion,
			},
			this.key(),
		);
	}

	async remove(ownerUserId: string, name: string): Promise<boolean> {
		const row = await this.db.workspaceSecret.findUnique({
			where: { ownerUserId_name: { ownerUserId, name } },
		});
		if (!row) return false;
		await this.db.workspaceSecret.delete({ where: { id: row.id } });
		return true;
	}
}

// -------------------------------------------------------- portal access codes

@Injectable()
export class PortalAccessService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/** Issues a code; the raw code is returned exactly once, only its hash is stored. */
	async issue(
		ownerUserId: string,
		label: string,
		options: {
			maxUses?: number;
			expiresAt?: Date | null;
		},
	): Promise<{
		id: string;
		code: string;
		expiresAt: Date | null;
		maxUses: number;
	}> {
		if (label.trim().length === 0)
			throw new WorkflowNonRetryableError("label is required");
		const maxUses = options.maxUses ?? 1;
		if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) {
			throw new WorkflowNonRetryableError(
				"maxUses must be an integer between 1 and 10000",
			);
		}
		const code = randomBytes(24).toString("hex");
		const row = await this.db.portalAccessCode.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				codeHash: hashCode(code),
				label,
				maxUses,
				expiresAt: options.expiresAt ?? null,
			},
		});
		return { id: row.id, code, expiresAt: row.expiresAt, maxUses };
	}

	/**
	 * CAS consume: the use counter advances only when still at the observed
	 * value and inside validity — concurrent consumes settle exactly maxUses.
	 */
	async consume(
		code: string,
		now = new Date(),
	): Promise<{ ok: true; portalId: string } | { ok: false; reason: string }> {
		const row = await this.db.portalAccessCode.findUnique({
			where: { codeHash: hashCode(code) },
		});
		if (!row) return { ok: false, reason: "unknown_code" };
		if (row.revokedAt) return { ok: false, reason: "revoked" };
		if (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
			return { ok: false, reason: "expired" };
		if (row.usedCount >= row.maxUses) return { ok: false, reason: "exhausted" };

		const won = await this.db.portalAccessCode.updateMany({
			where: { id: row.id, usedCount: row.usedCount, revokedAt: null },
			data: { usedCount: row.usedCount + 1 },
		});
		if (won.count !== 1) return { ok: false, reason: "exhausted" };
		return { ok: true, portalId: row.id };
	}

	async revoke(ownerUserId: string, id: string): Promise<boolean> {
		const won = await this.db.portalAccessCode.updateMany({
			where: { id, ownerUserId, revokedAt: null },
			data: { revokedAt: new Date() },
		});
		return won.count === 1;
	}

	async list(ownerUserId: string) {
		return this.db.portalAccessCode.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				label: true,
				maxUses: true,
				usedCount: true,
				expiresAt: true,
				revokedAt: true,
				createdAt: true,
			},
		});
	}
}

// -------------------------------------------------------------- domains

@Injectable()
export class WorkspaceDomainsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async register(ownerUserId: string, domain: string) {
		const normalized = domain.trim().toLowerCase();
		if (!isValidDomain(normalized)) {
			throw new WorkflowNonRetryableError(`Invalid domain ${domain}`);
		}
		const existing = await this.db.workspaceDomain.findUnique({
			where: { domain: normalized },
		});
		if (existing)
			throw new WorkflowNonRetryableError(
				`Domain ${normalized} is already registered`,
			);
		return this.db.workspaceDomain.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				domain: normalized,
				verificationToken: `citizen-lane-verify=${randomBytes(16).toString("hex")}`,
				status: "pending",
			},
		});
	}

	/**
	 * Verifies by DNS TXT token match (the caller supplies the TXT records it
	 * resolved; DNS I/O stays at the controller/edge).
	 */
	async verify(
		ownerUserId: string,
		domain: string,
		txtRecords: string[],
	): Promise<boolean> {
		const row = await this.db.workspaceDomain.findFirst({
			where: { domain: domain.trim().toLowerCase(), ownerUserId },
		});
		if (!row)
			throw new WorkflowNonRetryableError(`No domain ${domain} for this owner`);
		const matched = txtRecords.some((record) =>
			constantTimeHexEqual(record.trim(), row.verificationToken),
		);
		await this.db.workspaceDomain.update({
			where: { id: row.id },
			data: {
				status: matched ? "verified" : "failed",
				verifiedAt: matched ? new Date() : null,
			},
		});
		return matched;
	}

	async list(ownerUserId: string) {
		return this.db.workspaceDomain.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
	}
}

// ---------------------------------------------------------- suppression

@Injectable()
export class SuppressionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/** Idempotent add — double-unsubscribe is a no-op. */
	async suppress(
		ownerUserId: string,
		channel: string,
		handle: string,
		reason = "unsubscribe",
	): Promise<void> {
		const existing = await this.db.suppressionEntry.findUnique({
			where: {
				ownerUserId_channel_handle: {
					ownerUserId,
					channel,
					handle: handle.trim().toLowerCase(),
				},
			},
		});
		if (existing) return;
		await this.db.suppressionEntry.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				channel,
				handle: handle.trim().toLowerCase(),
				reason,
			},
		});
	}

	async isSuppressed(channel: string, handle: string): Promise<boolean> {
		const entry = await this.db.suppressionEntry.findFirst({
			where: { channel, handle: handle.trim().toLowerCase() },
		});
		return entry !== null;
	}

	async remove(
		ownerUserId: string,
		channel: string,
		handle: string,
	): Promise<boolean> {
		const won = await this.db.suppressionEntry.deleteMany({
			where: { ownerUserId, channel, handle: handle.trim().toLowerCase() },
		});
		return won.count > 0;
	}

	async list(ownerUserId: string) {
		return this.db.suppressionEntry.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
	}
}
