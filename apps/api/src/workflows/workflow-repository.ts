/**
 * Persistence ports for the workflow runner. The Prisma adapter lives in
 * `workflow-repository.prisma.ts`; tests substitute in-memory fakes so the
 * retry and journal semantics are exercised without a database.
 */

import type { WorkflowFailure } from "./workflow-errors";

export type WorkflowRunRecord = {
	id: string;
	workflowName: string;
	tenantUserId: string | null;
	input: Record<string, unknown>;
	maxAttempts: number;
};

export interface WorkflowRunRepository {
	create(record: WorkflowRunRecord): Promise<void>;
	/** Marks the run as running and returns the attempt number (1-based). */
	markRunning(id: string): Promise<number>;
	markSucceeded(id: string): Promise<void>;
	markFailed(
		id: string,
		failure: WorkflowFailure,
		expected: boolean,
	): Promise<void>;
	/** Recovery sweep: abandon runs stuck in `running` or `pending`. */
	abandonStale(before: Date): Promise<number>;
}

export type WorkflowStepRunRecord = {
	id: string;
	runId: string;
	stepName: string;
	maxRetries: number;
};

export interface WorkflowStepRunRepository {
	create(record: WorkflowStepRunRecord): Promise<void>;
	markRunning(id: string, attempt: number): Promise<void>;
	/**
	 * Records a failed attempt. `willRetry` marks the step `pending` again so
	 * operators can see retry churn; otherwise the step ends `failed`.
	 */
	markFailed(
		id: string,
		attempt: number,
		failure: WorkflowFailure,
		willRetry: boolean,
	): Promise<void>;
	markSucceeded(id: string, attempt: number): Promise<void>;
}
