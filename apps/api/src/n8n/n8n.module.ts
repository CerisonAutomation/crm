/**
 * n8n module: inbound automation triggers.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { RoutinesModule } from "../routines/routines.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { N8nService } from "./n8n.service";
import { N8nController } from "./n8n.controller";

@Module({
	imports: [DatabaseModule, WorkflowsModule, RoutinesModule, WebhooksModule],
	providers: [N8nService],
	controllers: [N8nController],
	exports: [N8nService],
})
export class N8nModule {}
