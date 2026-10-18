/**
 * Channels module: messaging providers, connected accounts, inbound
 * ingestion, guarded outbound send, and the tiered integration registry.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { RoutinesModule } from "../routines/routines.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { HardeningModule } from "../hardening/hardening.module";
import { EventsModule } from "../events/events.module";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { IntegrationRegistryService } from "./integration-registry.service";

@Module({
	imports: [DatabaseModule, RoutinesModule, WebhooksModule, WorkflowsModule, HardeningModule, EventsModule],
	providers: [ChannelsService, IntegrationRegistryService],
	controllers: [ChannelsController],
	exports: [ChannelsService, IntegrationRegistryService],
})
export class ChannelsModule {}
