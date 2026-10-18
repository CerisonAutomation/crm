import { describe, expect, it } from "bun:test";
import {
	capJson,
	MAX_ARRAY_ITEMS,
	truncateForStorage,
	truncateText,
} from "../src/workflows/storage-caps";
import { WorkflowLedgerService } from "../src/workflows/workflow-ledger.service";
import {
	WorkflowRunner,
	WorkflowDefinition,
	type WorkflowLedgerPort,
} from "../src/workflows/workflow-runner.service";
import type {
	WorkflowRunRecord,
	WorkflowRunRepository,
	WorkflowStepRunRecord,
	WorkflowStepRunRepository,
} from "../src/workflows/workflow-repository";

describe("storage caps (Postiz Temporal truncation)", () => {
	it("truncates long text with a marker", () => {
		const long = "x".repeat(9000);
		const cut = truncateText(long);
		expect(cut.length).toBe(4000);
		expect(cut.endsWith("…[truncated]")).toBe(true);
		expect(truncateText("short")).toBe("short");
	});

	it("caps arrays and object breadth", () => {
		const big = Array.from({ length: 200 }, (_, index) => index);
		const result = truncateForStorage(big) as unknown[];
		expect(result.length).toBe(MAX_ARRAY_ITEMS + 1);
		expect(String(result[result.length - 1])).toContain("150 more items");

		const wide: Record<string, unknown> = {};
		for (let index = 0; index < 80; index += 1) wide[`k${index}`] = index;
		const pruned = truncateForStorage(wide) as Record<string, unknown>;
		expect(Object.keys(pruned).length).toBe(51);
		expect(pruned.__truncated).toBe("30 more keys");
	});

	it("capJson degrades oversized payloads under the character budget", () => {
		const payload = { blob: "y".repeat(50_000) };
		const capped = capJson(payload) as Record<string, unknown>;
		expect(JSON.stringify(capped).length).toBeLessThanOrEqual(2000);
	});
});

class InMemoryLedgerDb {
	events: Array<Record<string, unknown>> = [];
	results: Array<Record<string, unknown>> = [];
	workflowEventLog = {
		create: async ({ data }: { data: Record<string, unknown> }) => {
			this.events.push(data);
			return data;
		},
		findMany: async () => this.events,
	};
	workflowStepResult = {
		create: async ({ data }: { data: Record<string, unknown> }) => {
			this.results.push(data);
			return data;
		},
		findMany: async () => this.results,
	};
}

describe("WorkflowLedgerService", () => {
	it("rejects unknown event kinds", async () => {
		const ledger = new WorkflowLedgerService(new InMemoryLedgerDb() as never);
		expect(
			ledger.appendEvent({ runId: "r1", kind: "run.exploded" }),
		).rejects.toThrow("Unknown ledger event kind");
	});

	it("caps payloads before persistence", async () => {
		const db = new InMemoryLedgerDb();
		const ledger = new WorkflowLedgerService(db as never);
		await ledger.appendEvent({
			runId: "r1",
			kind: "run.started",
			payload: { blob: "z".repeat(10_000) },
		});
		expect(JSON.stringify(db.events[0]?.payload).length).toBeLessThanOrEqual(2000);
	});

	it("never throws from recordStepResult (observability must not break runs)", async () => {
		const brokenDb = {
			workflowStepResult: {
				create: async () => {
					throw new Error("db down");
				},
			},
		};
		const ledger = new WorkflowLedgerService(brokenDb as never);
		await ledger.recordStepResult({ runId: "r", stepName: "s", attempt: 1, status: "failed" });
		expect(true).toBe(true);
	});
});

class InMemoryRunRepository implements WorkflowRunRepository {
	readonly rows = new Map<string, WorkflowRunRecord & { status: string; attemptCount: number }>();
	async create(record: WorkflowRunRecord): Promise<void> {
		this.rows.set(record.id, { ...record, status: "pending", attemptCount: 0 });
	}
	async markRunning(id: string): Promise<number> {
		const row = this.rows.get(id);
		if (!row) throw new Error("unknown run");
		row.status = "running";
		row.attemptCount += 1;
		return row.attemptCount;
	}
	async markSucceeded(id: string): Promise<void> {
		const row = this.rows.get(id);
		if (row) row.status = "succeeded";
	}
	async markFailed(): Promise<void> {
		const row = [...this.rows.values()][0];
		if (row) row.status = "failed";
	}
	async abandonStale(): Promise<number> {
		return 0;
	}
}

class InMemoryStepRepository implements WorkflowStepRunRepository {
	readonly rows = new Map<string, WorkflowStepRunRecord>();
	async create(record: WorkflowStepRunRecord): Promise<void> {
		this.rows.set(record.id, record);
	}
	async markRunning(): Promise<void> {}
	async markSucceeded(): Promise<void> {}
	async markFailed(): Promise<void> {}
}

class CapturingLedger implements WorkflowLedgerPort {
	readonly events: Array<{ kind: string; runId: string }> = [];
	readonly results: Array<{ status: string; stepName: string }> = [];
	async appendEvent(input: { runId: string; stepName?: string | null; kind: string; payload?: Record<string, unknown> }) {
		this.events.push({ kind: input.kind, runId: input.runId });
		return "event-id";
	}
	async recordStepResult(input: { runId: string; stepName: string; attempt: number; status: "succeeded" | "failed" | "skipped" }) {
		this.results.push({ status: input.status, stepName: input.stepName });
	}
}

describe("runner ledger integration", () => {
	it("emits run + step lifecycle events and step results", async () => {
		const ledger = new CapturingLedger();
		const runner = new WorkflowRunner(
			new InMemoryRunRepository() as never,
			new InMemoryStepRepository() as never,
			ledger,
		);

		const definition: WorkflowDefinition<{ n: number }, number> = {
			name: "math",
			handler: async (input, step) => {
				const doubled = await step("double", { maxRetries: 0 }, async () => input.n * 2);
				await step("boom", { maxRetries: 0 }, async () => {
					throw new Error("step exploded");
				});
				return doubled;
			},
		};

		const result = await runner.run(definition, { n: 21 });
		expect(result.ok).toBe(false);
		expect(ledger.events.map((event) => event.kind)).toEqual([
			"run.created",
			"run.started",
			"step.started",
			"step.succeeded",
			"step.started",
			"step.failed",
			"run.failed",
		]);
		expect(ledger.results.map((entry) => entry.status)).toEqual(["succeeded", "failed"]);
	});

	it("swallows ledger failures without failing the run", async () => {
		const brokenLedger: WorkflowLedgerPort = {
			appendEvent: async () => {
				throw new Error("ledger down");
			},
			recordStepResult: async () => {
				throw new Error("ledger down");
			},
		};
		const runner = new WorkflowRunner(
			new InMemoryRunRepository() as never,
			new InMemoryStepRepository() as never,
			brokenLedger,
		);
		const result = await runner.run(
			{ name: "ok", handler: async () => "done" },
			{},
		);
		expect(result.ok).toBe(true);
	});
});
