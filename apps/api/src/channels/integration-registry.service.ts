/**
 * Integration registry (pattern harvested from SeldonFrame tier1/tier2
 * integration loader): tier1 adapters register eagerly; tier2 adapters are
 * lazy and env-gated (`requiredEnv` must all be non-empty). `healthCheckAll`
 * initializes configured adapters and aggregates results.
 */

import { Injectable } from "@nestjs/common";
import type { AdapterDescriptor, ChannelAdapter } from "./channel-contracts";

@Injectable()
export class IntegrationRegistryService {
	private readonly tiers = new Map<string, AdapterDescriptor>();

	register(adapter: ChannelAdapter): void {
		if (this.tiers.has(adapter.id)) {
			throw new Error(`Integration ${adapter.id} is already registered`);
		}
		this.tiers.set(adapter.id, { id: adapter.id, tier: adapter.tier, adapter });
	}

	getAll(): AdapterDescriptor[] {
		return [...this.tiers.values()];
	}

	getById(id: string): ChannelAdapter | null {
		return this.tiers.get(id)?.adapter ?? null;
	}

	/** Tier2-style lazy filter: adapters whose env gates are all satisfied. */
	getConfigured(env: NodeJS.ProcessEnv = process.env): AdapterDescriptor[] {
		return this.getAll().filter((descriptor) => descriptor.adapter.isConfigured(env));
	}

	/** Tier1 eager list (registered adapters regardless of env). */
	getByTier(tier: "tier1" | "tier2"): AdapterDescriptor[] {
		return this.getAll().filter((descriptor) => descriptor.tier === tier);
	}

	async healthCheckAll(env: NodeJS.ProcessEnv = process.env): Promise<{
		checked: string[];
		results: Array<{ id: string; ok: boolean; detail?: string }>;
	}> {
		const configured = this.getConfigured(env);
		const results = await Promise.all(
			configured.map(async (descriptor) => {
				const result = await descriptor.adapter.healthCheck(env);
				return { id: descriptor.id, ok: result.ok, detail: result.detail };
			}),
		);
		return { checked: configured.map((descriptor) => descriptor.id), results };
	}
}

/** Helper for defining env-gated adapters (tier2 semantics). */
export function hasEnv(keys: string[], env: NodeJS.ProcessEnv = process.env): boolean {
	return keys.every((key) => typeof env[key] === "string" && (env[key] as string).length > 0);
}

/**
 * Generic env-gated adapter used by channel providers and any tier2
 * integration: configured exactly when every required env key is non-empty.
 */
export class ProviderEnvAdapter implements ChannelAdapter {
	constructor(
		public readonly id: string,
		public readonly tier: "tier1" | "tier2",
		public readonly requiredEnv: string[],
		private readonly probe?: () => Promise<{ ok: boolean; detail?: string }>,
	) {}

	isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
		return hasEnv(this.requiredEnv, env);
	}

	async healthCheck(env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; detail?: string }> {
		if (this.probe) return this.probe();
		const configured = this.isConfigured(env);
		return {
			ok: configured,
			detail: configured ? "env present" : `missing ${this.requiredEnv.join(", ")}`,
		};
	}
}
