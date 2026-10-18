/**
 * DI tokens for the workflow persistence ports so tests can substitute fakes.
 */

import type {
	WorkflowRunRepository,
	WorkflowStepRunRepository,
} from "./workflow-repository";

export const WORKFLOW_RUN_REPOSITORY = Symbol("WORKFLOW_RUN_REPOSITORY");
export const WORKFLOW_STEP_RUN_REPOSITORY = Symbol(
	"WORKFLOW_STEP_RUN_REPOSITORY",
);

export type WorkflowRunRepositoryToken = typeof WORKFLOW_RUN_REPOSITORY;
export type WorkflowStepRunRepositoryToken =
	typeof WORKFLOW_STEP_RUN_REPOSITORY;

export type { WorkflowRunRepository, WorkflowStepRunRepository };
