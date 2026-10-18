/**
 * Webhooks module: subscriptions, signed delivery, delivery journal.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import { WebhooksService } from "./webhooks.service";
import { WebhooksController } from "./webhooks.controller";

@Module({
	imports: [DatabaseModule, WorkflowsModule],
	providers: [WebhookDeliveryService, WebhooksService],
	controllers: [WebhooksController],
	exports: [WebhookDeliveryService, WebhooksService],
})
export class WebhooksModule {}
