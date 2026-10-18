/**
 * Soul — white-label identity inheritance (pattern harvested from SeldonFrame
 * U7: SOUL_SPEC + soul-sources/personality-cache).
 *
 * The identity layer (WHO: labels, tone, positioning, branding) is decoupled
 * from feature content (WHAT: blocks/workflows). A soul profile can inherit
 * from a parent profile: child keys override parent keys, everything else
 * flows down — the white-label "soul inheritance" model applied to resold
 * tenants. `resolveEffectiveSoul` is pure and chain-safe (cycle guard).
 */

import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

export type SoulLayer = {
	id: string;
	parentId: string | null;
	name: string;
	labels: Record<string, string>;
	tone: string;
	positioning: string | null;
	branding: Record<string, unknown>;
};

export type EffectiveSoul = {
	id: string;
	name: string;
	labels: Record<string, string>;
	tone: string;
	positioning: string | null;
	branding: Record<string, unknown>;
	/** Chain from root ancestor to this soul (for debugging/audit). */
	chain: string[];
};

const MAX_CHAIN = 16;

export function deepMergeRecords(
	base: Record<string, unknown>,
	overlay: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		const existing = result[key];
		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			existing !== null &&
			typeof existing === "object" &&
			!Array.isArray(existing)
		) {
			result[key] = deepMergeRecords(
				existing as Record<string, unknown>,
				value as Record<string, unknown>,
			);
		} else {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Resolves the effective soul from a chain: ancestors first (root wins the
 * earliest slots), each descendant overlaying its own values. Cycles and
 * chains longer than MAX_CHAIN throw — inheritance must be acyclic.
 */
export function resolveEffectiveSoul(
	soulId: string,
	byId: Map<string, SoulLayer>,
): EffectiveSoul {
	const chain: SoulLayer[] = [];
	const seen = new Set<string>();
	let cursor: SoulLayer | undefined = byId.get(soulId);

	while (cursor) {
		if (seen.has(cursor.id)) {
			throw new WorkflowNonRetryableError(
				`Soul inheritance cycle detected at ${cursor.id}`,
			);
		}
		if (chain.length >= MAX_CHAIN) {
			throw new WorkflowNonRetryableError(
				"Soul inheritance chain exceeds maximum depth",
			);
		}
		seen.add(cursor.id);
		chain.push(cursor);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}

	if (chain.length === 0) {
		throw new WorkflowNonRetryableError(`No soul profile ${soulId}`);
	}

	const rootToLeaf = [...chain].reverse();
	let labels: Record<string, string> = {};
	let branding: Record<string, unknown> = {};
	let tone = "professional";
	let positioning: string | null = null;
	let name = chain[0]?.name ?? "unnamed";

	for (const layer of rootToLeaf) {
		labels = { ...labels, ...layer.labels };
		branding = deepMergeRecords(branding, layer.branding);
		tone = layer.tone;
		positioning = layer.positioning ?? positioning;
		name = layer.name;
	}

	return {
		id: soulId,
		name,
		labels,
		tone,
		positioning,
		branding,
		chain: chain.map((layer) => layer.id),
	};
}

@Injectable()
export class SoulService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async create(
		ownerUserId: string,
		input: {
			name: string;
			parentId?: string | null;
			labels?: Record<string, string>;
			tone?: string;
			positioning?: string | null;
			branding?: Record<string, unknown>;
		},
	) {
		if (input.name.trim().length === 0)
			throw new WorkflowNonRetryableError("soul name is required");
		if (input.parentId) {
			const parent = await this.db.soulProfile.findFirst({
				where: { id: input.parentId, ownerUserId },
			});
			if (!parent)
				throw new WorkflowNonRetryableError(`No parent soul ${input.parentId}`);
		}
		return this.db.soulProfile.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				parentId: input.parentId ?? null,
				name: input.name,
				labels: (input.labels ?? {}) as Prisma.InputJsonValue,
				tone: input.tone ?? "professional",
				positioning: input.positioning ?? null,
				branding: (input.branding ?? {}) as Prisma.InputJsonValue,
			},
		});
	}

	async list(ownerUserId: string) {
		return this.db.soulProfile.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "asc" },
		});
	}

	/**
	 * Effective soul with inheritance resolved. Loads the owner's profiles
	 * once (chains are short; a per-owner load keeps the cycle guard honest).
	 */
	async effective(ownerUserId: string, soulId: string): Promise<EffectiveSoul> {
		const rows = await this.db.soulProfile.findMany({ where: { ownerUserId } });
		const byId = new Map<string, SoulLayer>(
			rows.map((row) => [
				row.id,
				{
					id: row.id,
					parentId: row.parentId,
					name: row.name,
					labels: row.labels as Record<string, string>,
					tone: row.tone,
					positioning: row.positioning,
					branding: row.branding as Record<string, unknown>,
				},
			]),
		);
		return resolveEffectiveSoul(soulId, byId);
	}
}
