/**
 * Events module: the unified domain-event seam (routines + webhooks + gates).
 */

import { Module } from "@nestjs/common";
import { RoutinesModule } from "../routines/routines.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { EventDispatcherService } from "./event-dispatcher.service";

@Module({
	imports: [RoutinesModule, WebhooksModule, WorkflowsModule],
	providers: [EventDispatcherService],
	exports: [EventDispatcherService],
})
export class EventsModule {}
