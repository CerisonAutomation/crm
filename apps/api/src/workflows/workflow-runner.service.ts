/**
 * Durable workflow runner.
 *
 * Semantics extracted from the Customermates workflow engine (built on
 * `@ai-sdk/workflow` "use workflow" / "use step" directives) and rebuilt
 * natively for NestJS:
 *
 *  - every workflow run is journaled to `WorkflowRun`;
 *  - every named step is journaled to `WorkflowStepRun` with its own
 *    `maxRetries` budget (steps marked `maxRetries = 0` never rerun);
 *  - retries use exponential backoff (base 500 ms, cap 15 s) and skip
 *    non-retryable failures immediately;
 *  - a crashed API process leaves runs in `running`; the recovery sweep
 *    (`reconcile-routine-runs` workflow) abandons runs whose lease expired;
 *  - unexpected failures are reported through `capture-failure` before the
 *    error is rethrown; expected failures stay silent.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { reportFailure } from "./capture-failure";
import {
	isNonRetryable,
	toWorkflowFailure,
	type WorkflowTenant,
} from "./workflow-errors";
import type { WorkflowRunRepository, WorkflowStepRunRepository } from "./workflow-repository";
import { capJson } from "./storage-caps";
import { WORKFLOW_RUN_REPOSITORY, WORKFLOW_STEP_RUN_REPOSITORY } from "./workflow-repository.tokens";

export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 15_000;

export type StepRunOptions = {
	/** Additional attempts allowed after the first one. `0` means run once. */
	maxRetries: number;
};

export type WorkflowDefinition<TInput, TResult> = {
	name: string;
	handler: (input: TInput, step: StepExecutor) => Promise<TResult>;
};

export type StepExecutor = <T>(stepName: string, options: StepRunOptions, fn: () => Promise<T>) => Promise<T>;

export function retryDelayMs(retryIndex: number): number {
	const exponential = RETRY_BASE_DELAY_MS * 2 ** retryIndex;
	return Math.min(exponential, RETRY_MAX_DELAY_MS);
}

/** Optional workflow ledger port (SeldonFrame U9 step-results + event-log). */
export const WORKFLOW_LEDGER_TOKEN = "WORKFLOW_LEDGER";

export type WorkflowLedgerPort = {
	appendEvent(input: {
		runId: string;
		stepName?: string | null;
		kind: string;
		payload?: Record<string, unknown>;
	}): Promise<string>;
	recordStepResult(input: {
		runId: string;
		stepName: string;
		attempt: number;
		status: "succeeded" | "failed" | "skipped";
		input?: unknown;
		output?: unknown;
		error?: string;
	}): Promise<void>;
};

export type RunWorkflowOptions = {
	tenant?: WorkflowTenant;
	/** Overrides the default retry budget when a run is re-dispatched. */
	maxAttempts?: number;
};

export type RunWorkflowResult<TResult> =
	| { ok: true; runId: string; result: TResult }
	| { ok: false; runId: string; failure: ReturnType<typeof toWorkflowFailure> };

@Injectable()
export class WorkflowRunner {
	private readonly logger = new Logger(WorkflowRunner.name);

	constructor(
		@Inject(WORKFLOW_RUN_REPOSITORY) private readonly runs: WorkflowRunRepository,
		@Inject(WORKFLOW_STEP_RUN_REPOSITORY) private readonly steps: WorkflowStepRunRepository,
		@Optional() @Inject(WORKFLOW_LEDGER_TOKEN) private readonly ledger?: WorkflowLedgerPort,
	) {}

	/** Ledger writes are observability: they must never fail the run itself. */
	private async ledgerEvent(kind: string, runId: string, stepName: string | null, payload: Record<string, unknown>): Promise<void> {
		try {
			await this.ledger?.appendEvent({ runId, stepName, kind, payload });
		} catch (error) {
			this.logger.warn(`Ledger event ${kind} failed: ${String(error)}`);
		}
	}

	private async ledgerStepResult(input: {
		runId: string;
		stepName: string;
		attempt: number;
		status: "succeeded" | "failed";
		output?: unknown;
		error?: string;
	}): Promise<void> {
		try {
			await this.ledger?.recordStepResult(input);
		} catch (error) {
			this.logger.warn(`Ledger step result failed: ${String(error)}`);
		}
	}

	async run<TInput, TResult>(
		definition: WorkflowDefinition<TInput, TResult>,
		input: TInput,
		options: RunWorkflowOptions = {},
	): Promise<RunWorkflowResult<TResult>> {
		const runId = randomUUID();
		const maxAttempts = options.maxAttempts ?? 3;
		await this.runs.create({
			id: runId,
			workflowName: definition.name,
			tenantUserId: options.tenant?.userId ?? null,
			input: capJson(input) as Record<string, unknown>,
			maxAttempts,
		});
		await this.ledgerEvent("run.created", runId, null, { workflowName: definition.name });
		return this.execute(definition, input, runId, options, maxAttempts);
	}

	private async execute<TInput, TResult>(
		definition: WorkflowDefinition<TInput, TResult>,
		input: TInput,
		runId: string,
		options: RunWorkflowOptions,
		maxAttempts: number,
	): Promise<RunWorkflowResult<TResult>> {
		const attempt = await this.runs.markRunning(runId);
		if (attempt > maxAttempts) {
			const failure = toWorkflowFailure(
				new Error(`Workflow ${definition.name} exhausted its ${maxAttempts} run attempts`),
			);
			await this.runs.markFailed(runId, failure, true);
			await this.ledgerEvent("run.abandoned", runId, null, { reason: "attempts_exhausted" });
			return { ok: false, runId, failure };
		}
		await this.ledgerEvent("run.started", runId, null, { attempt });

		try {
			const result = await definition.handler(input, this.createStepExecutor(runId));
			await this.runs.markSucceeded(runId);
			await this.ledgerEvent("run.succeeded", runId, null, {});
			return { ok: true, runId, result };
		} catch (error) {
			const failure = toWorkflowFailure(error);
			await this.runs.markFailed(runId, failure, failure.expected === true);
			await this.ledgerEvent("run.failed", runId, null, {
				failureName: failure.name,
				failureMessage: failure.message,
				expected: failure.expected === true,
			});
			if (failure.expected !== true) {
				await reportFailure(definition.name, failure, options.tenant);
			}
			this.logger.error({
				message: `Workflow ${definition.name} failed`,
				runId,
				name: failure.name,
				error: failure.message,
			});
			return { ok: false, runId, failure };
		}
	}

	/** Recovery sweep used by the reconcile-routine-runs workflow. */
	async abandonStaleRuns(before: Date): Promise<number> {
		return this.runs.abandonStale(before);
	}

	private createStepExecutor(runId: string): StepExecutor {
		return async <T>(stepName: string, options: StepRunOptions, fn: () => Promise<T>): Promise<T> => {
			const stepRunId = randomUUID();
			const maxAttempts = options.maxRetries + 1;
			await this.steps.create({
				id: stepRunId,
				runId,
				stepName,
				maxRetries: options.maxRetries,
			});
			await this.ledgerEvent("step.started", runId, stepName, { maxAttempts });

			for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
				await this.steps.markRunning(stepRunId, attempt);
				try {
					const value = await fn();
					await this.steps.markSucceeded(stepRunId, attempt);
					await this.ledgerEvent("step.succeeded", runId, stepName, { attempt });
					await this.ledgerStepResult({
						runId,
						stepName,
						attempt,
						status: "succeeded",
						output: value,
					});
					return value;
				} catch (error) {
					const lastAttempt = attempt === maxAttempts;
					const retrying = !lastAttempt && !isNonRetryable(error);
					await this.steps.markFailed(stepRunId, attempt, toWorkflowFailure(error), retrying);
					const failure = toWorkflowFailure(error);
					await this.ledgerEvent(retrying ? "step.retrying" : "step.failed", runId, stepName, {
						attempt,
						failureName: failure.name,
						failureMessage: failure.message,
					});
					if (!retrying) {
						await this.ledgerStepResult({
							runId,
							stepName,
							attempt,
							status: "failed",
							error: failure.message,
						});
						throw error;
					}
					const delay = retryDelayMs(attempt - 1);
					await new Promise((resolve) => {
						setTimeout(resolve, delay);
					});
				}
			}

			throw new Error(`Step ${stepName} finished without a result`);
		};
	}
}
