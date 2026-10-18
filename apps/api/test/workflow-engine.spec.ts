import { describe, expect, it } from "bun:test";
import type { WorkflowFailure } from "../src/workflows/workflow-errors";
import {
	isNonRetryable,
	isRetryableStatus,
	toWorkflowFailure,
	WebhookExternalFailure,
	WebhookNonRetryableFailure,
	WorkflowNonRetryableError,
} from "../src/workflows/workflow-errors";
import type {
	WorkflowRunRecord,
	WorkflowRunRepository,
	WorkflowStepRunRecord,
	WorkflowStepRunRepository,
} from "../src/workflows/workflow-repository";
import {
	retryDelayMs,
	type StepRunOptions,
	type WorkflowDefinition,
	WorkflowRunner,
} from "../src/workflows/workflow-runner.service";

class InMemoryRunRepository implements WorkflowRunRepository {
	readonly rows = new Map<
		string,
		WorkflowRunRecord & {
			status: string;
			attemptCount: number;
			failure?: WorkflowFailure;
		}
	>();

	async create(record: WorkflowRunRecord): Promise<void> {
		this.rows.set(record.id, { ...record, status: "pending", attemptCount: 0 });
	}

	async markRunning(id: string): Promise<number> {
		const row = this.rows.get(id);
		if (!row) throw new Error(`unknown run ${id}`);
		row.status = "running";
		row.attemptCount += 1;
		return row.attemptCount;
	}

	async markSucceeded(id: string): Promise<void> {
		const row = this.rows.get(id);
		if (!row) throw new Error(`unknown run ${id}`);
		row.status = "succeeded";
	}

	async markFailed(
		id: string,
		failure: WorkflowFailure,
		expected: boolean,
	): Promise<void> {
		const row = this.rows.get(id);
		if (!row) throw new Error(`unknown run ${id}`);
		row.status = "failed";
		row.failure = { ...failure, expected };
	}

	async abandonStale(before: Date): Promise<number> {
		let count = 0;
		for (const row of this.rows.values()) {
			if (row.status === "running" || row.status === "pending") {
				row.status = "abandoned";
				count += 1;
			}
		}
		void before;
		return count;
	}
}

class InMemoryStepRepository implements WorkflowStepRunRepository {
	readonly rows = new Map<
		string,
		WorkflowStepRunRecord & { status: string; attemptCount: number }
	>();

	async create(record: WorkflowStepRunRecord): Promise<void> {
		this.rows.set(record.id, { ...record, status: "pending", attemptCount: 0 });
	}

	async markRunning(id: string, attempt: number): Promise<void> {
		const row = this.rows.get(id);
		if (!row) throw new Error(`unknown step ${id}`);
		row.status = "pending";
		row.attemptCount = attempt;
	}

	async markFailed(
		id: string,
		attempt: number,
		_failure: WorkflowFailure,
		willRetry: boolean,
	): Promise<void> {
		const row = this.rows.get(id);
		if (!row) throw new Error(`unknown step ${id}`);
		row.status = willRetry ? "pending" : "failed";
		row.attemptCount = attempt;
	}

	async markSucceeded(id: string, attempt: number): Promise<void> {
		const row = this.rows.get(id);
		if (!row) throw new Error(`unknown step ${id}`);
		row.status = "succeeded";
		row.attemptCount = attempt;
	}
}

function makeRunner() {
	const runs = new InMemoryRunRepository();
	const steps = new InMemoryStepRepository();
	return { runs, steps, runner: new WorkflowRunner(runs, steps) };
}

describe("the workflow retry schedule", () => {
	it("backs off exponentially and caps at 15 seconds", () => {
		expect(retryDelayMs(0)).toBe(500);
		expect(retryDelayMs(1)).toBe(1000);
		expect(retryDelayMs(2)).toBe(2000);
		expect(retryDelayMs(5)).toBe(15_000);
		expect(retryDelayMs(50)).toBe(15_000);
	});

	it("classifies webhook HTTP statuses the way the Customermates engine does", () => {
		expect(isRetryableStatus(null)).toBe(true);
		expect(isRetryableStatus(500)).toBe(true);
		expect(isRetryableStatus(503)).toBe(true);
		expect(isRetryableStatus(408)).toBe(true);
		expect(isRetryableStatus(425)).toBe(true);
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(400)).toBe(false);
		expect(isRetryableStatus(404)).toBe(false);
		expect(isRetryableStatus(422)).toBe(false);
	});

	it("treats non-retryable failures as non-retryable everywhere", () => {
		expect(isNonRetryable(new WorkflowNonRetryableError("nope"))).toBe(true);
		expect(isNonRetryable(new WebhookNonRetryableFailure(404, "missing"))).toBe(
			true,
		);
		expect(isNonRetryable(new Error("boom"))).toBe(false);
		expect(isNonRetryable(new WebhookExternalFailure(503, "down"))).toBe(false);
	});
});

describe("a durable run", () => {
	it("retries a failing step up to its maxRetries and then fails the run", async () => {
		const { runs, steps, runner } = makeRunner();
		let attempts = 0;
		const flaky: WorkflowDefinition<{ n: number }, string> = {
			name: "flaky",
			async handler(_input, step) {
				return step("boom", { maxRetries: 2 }, async () => {
					attempts += 1;
					throw new Error(`attempt ${attempts}`);
				});
			},
		};

		const outcome = await runner.run(flaky, { n: 1 });
		expect(outcome.ok).toBe(false);
		expect(attempts).toBe(3);
		const run = [...runs.rows.values()][0]!;
		expect(run.status).toBe("failed");
		expect(run.failure?.message).toBe("attempt 3");
		const stepRow = [...steps.rows.values()][0]!;
		expect(stepRow.status).toBe("failed");
		expect(stepRow.attemptCount).toBe(3);
	});

	it("stops immediately when the step throws a non-retryable error", async () => {
		const { runs, runner } = makeRunner();
		let attempts = 0;
		const hardStop: WorkflowDefinition<Record<string, never>, string> = {
			name: "hard-stop",
			async handler(_input, step) {
				return step("guard", { maxRetries: 5 }, async () => {
					attempts += 1;
					throw new WorkflowNonRetryableError("precondition failed");
				});
			},
		};

		const outcome = await runner.run(hardStop, {});
		expect(outcome.ok).toBe(false);
		expect(attempts).toBe(1);
		expect(outcome.ok === false && outcome.failure.expected).toBe(true);
		const run = [...runs.rows.values()][0]!;
		expect(run.status).toBe("failed");
	});

	it("honors maxRetries = 0 (run-once steps) and journals success", async () => {
		const { runs, steps, runner } = makeRunner();
		let calls = 0;
		const once: WorkflowDefinition<Record<string, never>, number> = {
			name: "run-once",
			async handler(_input, step) {
				return step("once", { maxRetries: 0 }, async () => {
					calls += 1;
					return 41;
				});
			},
		};

		const outcome = await runner.run(once, {});
		expect(outcome.ok).toBe(true);
		expect(calls).toBe(1);
		expect(outcome.ok && outcome.result).toBe(41);
		const run = [...runs.rows.values()][0]!;
		expect(run.status).toBe("succeeded");
		const stepRow = [...steps.rows.values()][0]!;
		expect(stepRow.status).toBe("succeeded");
		expect(stepRow.attemptCount).toBe(1);
	});

	it("retries a transient failure and succeeds on the second attempt", async () => {
		const { steps, runner } = makeRunner();
		let calls = 0;
		const transient: WorkflowDefinition<Record<string, never>, string> = {
			name: "transient",
			async handler(_input, step) {
				return step("fetch", { maxRetries: 1 }, async () => {
					calls += 1;
					if (calls === 1) throw new Error("connection reset");
					return "fetched";
				});
			},
		};

		const outcome = await runner.run(transient, {});
		expect(outcome.ok).toBe(true);
		expect(calls).toBe(2);
		const stepRow = [...steps.rows.values()][0]!;
		expect(stepRow.status).toBe("succeeded");
		expect(stepRow.attemptCount).toBe(2);
	});

	it("abandons stale runs during the recovery sweep", async () => {
		const { runs, runner } = makeRunner();
		const stuck: WorkflowDefinition<Record<string, never>, void> = {
			name: "stuck",
			async handler() {
				/* never finishes */
			},
		};
		void stuck;
		await runs.create({
			id: "run-1",
			workflowName: "stuck",
			tenantUserId: null,
			input: {},
			maxAttempts: 3,
		});
		await runs.markRunning("run-1");
		const abandoned = await runner.abandonStaleRuns(new Date());
		expect(abandoned).toBe(1);
		expect(runs.rows.get("run-1")?.status).toBe("abandoned");
	});

	it("marks unexpected failures as not expected so the reporter sees them", async () => {
		const failure = toWorkflowFailure(new Error("kaboom"));
		expect(failure.expected).toBe(false);
		expect(failure.message).toBe("kaboom");
		const expectedFailure = toWorkflowFailure(
			new WebhookNonRetryableFailure(404, "gone"),
		);
		expect(expectedFailure.expected).toBe(true);
	});

	it("runs steps sequentially with their own journals", async () => {
		const { steps, runner } = makeRunner();
		const pipeline: WorkflowDefinition<Record<string, never>, string> = {
			name: "pipeline",
			async handler(_input, step) {
				const a = await step("first", { maxRetries: 0 }, async () => "A");
				const b = await step("second", { maxRetries: 0 }, async () => "B");
				return a + b;
			},
		};
		const outcome = await runner.run(pipeline, {});
		expect(outcome.ok && outcome.result).toBe("AB");
		expect(steps.rows.size).toBe(2);
		const names = [...steps.rows.values()].map((row) => row.stepName);
		expect(names).toEqual(["first", "second"]);
	});

	it("satisfies the StepExecutor options contract", () => {
		const options: StepRunOptions = { maxRetries: 3 };
		expect(options.maxRetries).toBe(3);
	});
});
