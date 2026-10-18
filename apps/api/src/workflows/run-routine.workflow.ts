/**
 * run-routine workflow (extracted from Customermates `workflows/run-routine.ts`).
 *
 * Starting a routine run is a single, never-retried step: a double-start would
 * duplicate work. A start failure settles the run as failed (`reason`
 * distinguishes an inactive owner from a generic start failure); expected
 * failures end the workflow quietly, unexpected ones are reported and rethrown.
 */

import {
	isExpectedError,
	WorkflowNonRetryableError,
	type WorkflowTenant,
} from "./workflow-errors";
import type { StepExecutor, WorkflowRunner } from "./workflow-runner.service";
import { reportFailure } from "./capture-failure";
import { toWorkflowFailure } from "./workflow-errors";

const WORKFLOW_NAME = "run-routine";
const ROUTINE_DID_NOT_START = "Routine run did not start";

export type RunRoutineWorkflowPayload = {
	routineRunId: string;
	ownerUserId: string | null;
	tenant?: WorkflowTenant;
};

export type RoutineStartOutcome = "started" | "ownerInactive" | "startFailed";

export type RunRoutinePort = {
	/** Starts the run and dispatches its body (agent turn / automation). */
	startRoutineRun(input: { routineRunId: string; ownerUserId: string | null }): Promise<void>;
	failRoutineRun(input: { routineRunId: string; reason: string }): Promise<void>;
};

export function classifyStartFailure(error: unknown): RoutineStartOutcome {
	const message = error instanceof Error ? error.message : String(error);
	return message.toLowerCase().includes("inactive") ? "ownerInactive" : "startFailed";
}

export function buildRunRoutineWorkflow(port: RunRoutinePort) {
	return {
		name: WORKFLOW_NAME,
		async handler(payload: RunRoutineWorkflowPayload, step: StepExecutor): Promise<void> {
			const { tenant } = payload;

			try {
				await step("startRoutineRunStep", { maxRetries: 0 }, async () => {
					try {
						await port.startRoutineRun({
							routineRunId: payload.routineRunId,
							ownerUserId: payload.ownerUserId,
						});
					} catch (error) {
						await port.failRoutineRun({
							routineRunId: payload.routineRunId,
							reason: classifyStartFailure(error),
						});

						if (!isExpectedError(error)) {
							throw error;
						}
						throw new WorkflowNonRetryableError(ROUTINE_DID_NOT_START);
					}
				});
			} catch (err) {
				if (err instanceof WorkflowNonRetryableError && err.message === ROUTINE_DID_NOT_START) {
					return;
				}
				await reportFailure(WORKFLOW_NAME, toWorkflowFailure(err), tenant);
				throw err;
			}
		},
	};
}

export type RunRoutineWorkflow = ReturnType<typeof buildRunRoutineWorkflow>;

export async function runRoutineWorkflow(
	runner: WorkflowRunner,
	workflow: RunRoutineWorkflow,
	payload: RunRoutineWorkflowPayload,
): Promise<ReturnType<WorkflowRunner["run"]>> {
	return runner.run(workflow, payload, { tenant: payload.tenant });
}
