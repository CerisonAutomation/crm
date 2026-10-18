/**
 * trigger-test-error workflow (extracted from Customermates
 * `workflows/trigger-test-error.ts`). Operators dispatch it to verify that the
 * failure pipeline (step journal + reporter) is wired end to end.
 */

import type { StepExecutor, WorkflowRunner } from "./workflow-runner.service";
import { reportFailure } from "./capture-failure";
import { toWorkflowFailure, type WorkflowTenant } from "./workflow-errors";

const WORKFLOW_NAME = "trigger-test-error";

export type TriggerTestErrorPayload = {
	message: string;
	tenant?: WorkflowTenant;
};

export const triggerTestErrorWorkflow = {
	name: WORKFLOW_NAME,
	async handler(payload: TriggerTestErrorPayload, step: StepExecutor): Promise<never> {
		try {
			await step(
				"failStep",
				{ maxRetries: 0 },
				async () => {
					await new Promise((resolve) => {
						setTimeout(resolve, 100);
					});
					throw new Error(payload.message);
				},
			);
			throw new Error("failStep must throw");
		} catch (err) {
			await reportFailure(WORKFLOW_NAME, toWorkflowFailure(err), payload.tenant);
			throw err;
		}
	},
};

export type TriggerTestErrorWorkflow = typeof triggerTestErrorWorkflow;

export async function runTriggerTestErrorWorkflow(
	runner: WorkflowRunner,
	payload: TriggerTestErrorPayload,
): Promise<ReturnType<WorkflowRunner["run"]>> {
	return runner.run(triggerTestErrorWorkflow, payload, { tenant: payload.tenant });
}
