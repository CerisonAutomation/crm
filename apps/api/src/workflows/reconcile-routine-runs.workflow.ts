/**
 * reconcile-routine-runs workflow (extracted from Customermates
 * `workflows/reconcile-routine-runs.ts`).
 *
 * The recovery sweep keeps the automation layer honest after crashes:
 *  1. normalize expired leases — runs stuck in `running` past the heartbeat
 *     window are settled so their owners are not wedged;
 *  2. settle routine runs — `queued` runs whose window passed become `skipped`,
 *     runs with dead workflows become `failed`.
 * Both steps are `maxRetries = 0`: the sweep itself is idempotent and reruns
 * on the next tick.
 */

import { reportFailure } from "./capture-failure";
import { toWorkflowFailure, type WorkflowTenant } from "./workflow-errors";
import type { StepExecutor, WorkflowRunner } from "./workflow-runner.service";

const WORKFLOW_NAME = "reconcile-routine-runs";

export type ReconcileRoutineRunsWorkflowPayload = {
	ownerUserId: string | null;
	tenant?: WorkflowTenant;
};

export type ReconcileRoutineRunsPort = {
	/** Abandons workflow runs whose heartbeat expired. Returns rows touched. */
	normalizeExpiredWorkflowRuns(asOf: Date): Promise<number>;
	/** Settles orphaned routine runs. Returns rows touched. */
	settleRoutineRuns(input: {
		ownerUserId: string | null;
		asOf: Date;
	}): Promise<number>;
};

export function buildReconcileRoutineRunsWorkflow(
	port: ReconcileRoutineRunsPort,
) {
	return {
		name: WORKFLOW_NAME,
		async handler(
			payload: ReconcileRoutineRunsWorkflowPayload,
			step: StepExecutor,
		): Promise<{ abandonedRuns: number; settledRuns: number }> {
			const { tenant } = payload;

			try {
				const abandonedRuns = await step(
					"normalizeExpiredWorkflowRunsStep",
					{ maxRetries: 0 },
					() => port.normalizeExpiredWorkflowRuns(new Date()),
				);
				const settledRuns = await step(
					"settleRoutineRunsStep",
					{ maxRetries: 0 },
					() =>
						port.settleRoutineRuns({
							ownerUserId: payload.ownerUserId,
							asOf: new Date(),
						}),
				);
				return { abandonedRuns, settledRuns };
			} catch (err) {
				await reportFailure(WORKFLOW_NAME, toWorkflowFailure(err), tenant);
				throw err;
			}
		},
	};
}

export type ReconcileRoutineRunsWorkflow = ReturnType<
	typeof buildReconcileRoutineRunsWorkflow
>;

export async function runReconcileRoutineRunsWorkflow(
	runner: WorkflowRunner,
	workflow: ReconcileRoutineRunsWorkflow,
	payload: ReconcileRoutineRunsWorkflowPayload,
): Promise<ReturnType<WorkflowRunner["run"]>> {
	return runner.run(workflow, payload, { tenant: payload.tenant });
}
