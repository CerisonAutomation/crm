/**
 * DI smoke: boots the Nest app graph and resolves every harvested module's
 * services from the container. Proves the modules are LINKED (imports,
 * providers, tokens) rather than islands. Run: bun api/di-smoke.ts
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/crm";
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "smoke-secret-that-is-long-enough-0123456789";
process.env.WORKSPACE_SECRETS_KEY = process.env.WORKSPACE_SECRETS_KEY ?? Buffer.alloc(32, 9).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "smoke-verify";
process.env.CRON_SECRET = process.env.CRON_SECRET ?? "smoke-cron-secret-0123456789";
process.env.ALLOWED_SIGN_IN = process.env.ALLOWED_SIGN_IN ?? "example.com";
process.env.MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "smoke-mcp";
process.env.N8N_TRIGGER_TOKEN = process.env.N8N_TRIGGER_TOKEN ?? "smoke-n8n";

const TARGETS: Array<[string, string]> = [
	["BookingService", "BookingService"],
	["ChannelsService", "ChannelsService"],
	["IntegrationRegistryService", "IntegrationRegistryService"],
	["WorkflowGatesService", "WorkflowGatesService"],
	["SendClaimService", "SendClaimService"],
	["WorkflowLedgerService", "WorkflowLedgerService"],
	["WorkflowRunner", "WorkflowRunner"],
	["EventDispatcherService", "EventDispatcherService"],
	["AgentGovernanceService", "AgentGovernanceService"],
	["BrainService", "BrainService"],
	["SoulService", "SoulService"],
	["WorkspaceSecretsService", "WorkspaceSecretsService"],
	["PortalAccessService", "PortalAccessService"],
	["WorkspaceDomainsService", "WorkspaceDomainsService"],
	["SuppressionService", "SuppressionService"],
	["RoutinesService", "RoutinesService"],
	["WebhooksService", "WebhooksService"],
	["McpToolsService", "McpToolsService"],
	["BookingCalendarService", "BookingCalendarService"],
	["ResumableWorkflowService", "ResumableWorkflowService"],
];

async function main(): Promise<void> {
	const { createApp } = await import("./src/create-app");
	const { ModulesContainer } = await import("@nestjs/core");

	const app = await createApp();
	const modules = app.get(ModulesContainer);

	const registry = new Map<string, unknown>();
	for (const nestModule of modules.values()) {
		for (const provider of nestModule.providers.values()) {
			const name = (provider.metatype as { name?: string } | undefined)?.name;
			if (name) registry.set(name, provider.instance);
		}
	}

	let resolved = 0;
	const missing: string[] = [];
	for (const [label, key] of TARGETS) {
		const instance = registry.get(key);
		if (instance !== undefined && instance !== null) {
			resolved += 1;
			process.stdout.write(`  ok  ${label}\n`);
		} else {
			missing.push(label);
			process.stdout.write(`  MISSING  ${label}\n`);
		}
	}

	const ledgerBound =
		registry.get("WorkflowRunner") !== undefined &&
		typeof (registry.get("WorkflowRunner") as { ledger?: unknown }).ledger !== "undefined";

	// Probe a real dispatch path through the linked services against the DB:
	const runner = registry.get("WorkflowRunner") as {
		run(definition: unknown, input: unknown): Promise<{ ok: boolean; runId: string }>;
	};
	const run = await runner.run(
		{ name: "di-smoke", handler: async () => "ok" },
		{},
	);
	const gates = registry.get("WorkflowGatesService") as {
		registerWait(input: Record<string, unknown>): Promise<{ id: string }>;
		resumeByEvent(event: string, payload: Record<string, unknown>): Promise<unknown>;
	};
	await gates.registerWait({
		runId: run.runId,
		stepName: "smoke",
		matchEvent: "smoke.ping",
		matchPredicate: {},
		timeoutAt: null,
	});
	const resumed = await gates.resumeByEvent("smoke.ping", {});
	const linked = resumed !== null;

	await app.close();

	process.stdout.write(
		`\nDI SMOKE: ${resolved}/${TARGETS.length} resolved, ledger-token=${String(ledgerBound)}, gate-wake=${String(linked)}\n`,
	);
	if (missing.length > 0 || !linked) {
		process.stdout.write(`FAILED: missing=${missing.join(",")}\n`);
		process.exit(1);
	}
	process.stdout.write("DI SMOKE OK — all modules linked\n");
	process.exit(0);
}

void main().catch((error: unknown) => {
	process.stdout.write(`DI SMOKE CRASHED: ${String(error)}\n`);
	process.exit(1);
});
