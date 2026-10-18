/**
 * Workflow engine module: runner + registry + Prisma adapters.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { WorkflowRunner, WORKFLOW_LEDGER_TOKEN } from "./workflow-runner.service";
import { WorkflowGatesService } from "./workflow-gates.service";
import { SendClaimService } from "./send-claim.service";
import { WorkflowLedgerService } from "./workflow-ledger.service";
import { ResumableWorkflowService } from "./resumable-workflow.service";
import { WorkflowRegistry } from "./workflow-registry.service";
import {
	PrismaWorkflowRunRepository,
	PrismaWorkflowStepRunRepository,
} from "./workflow-repository.prisma";
import {
	WORKFLOW_RUN_REPOSITORY,
	WORKFLOW_STEP_RUN_REPOSITORY,
} from "./workflow-repository.tokens";

@Module({
	imports: [DatabaseModule],
	providers: [
		WorkflowGatesService,
		SendClaimService,
		WorkflowLedgerService,
		ResumableWorkflowService,
		{ provide: WORKFLOW_LEDGER_TOKEN, useExisting: WorkflowLedgerService },
		WorkflowRegistry,
		{
			provide: WORKFLOW_RUN_REPOSITORY,
			useClass: PrismaWorkflowRunRepository,
		},
		{
			provide: WORKFLOW_STEP_RUN_REPOSITORY,
			useClass: PrismaWorkflowStepRunRepository,
		},
		WorkflowRunner,
	],
	exports: [WorkflowRunner, WorkflowRegistry, WorkflowGatesService, SendClaimService, WorkflowLedgerService, ResumableWorkflowService],
})
export class WorkflowsModule {}
