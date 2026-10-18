/**
 * Workflow engine module: runner + registry + Prisma adapters.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ResumableWorkflowService } from "./resumable-workflow.service";
import { SendClaimService } from "./send-claim.service";
import { WorkflowGatesService } from "./workflow-gates.service";
import { WorkflowLedgerService } from "./workflow-ledger.service";
import { WorkflowRegistry } from "./workflow-registry.service";
import {
	PrismaWorkflowRunRepository,
	PrismaWorkflowStepRunRepository,
} from "./workflow-repository.prisma";
import {
	WORKFLOW_RUN_REPOSITORY,
	WORKFLOW_STEP_RUN_REPOSITORY,
} from "./workflow-repository.tokens";
import {
	WORKFLOW_LEDGER_TOKEN,
	WorkflowRunner,
} from "./workflow-runner.service";

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
	exports: [
		WorkflowRunner,
		WorkflowRegistry,
		WorkflowGatesService,
		SendClaimService,
		WorkflowLedgerService,
		ResumableWorkflowService,
	],
})
export class WorkflowsModule {}
