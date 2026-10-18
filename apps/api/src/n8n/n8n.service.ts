/**
 * n8n integration service.
 *
 * Two directions (the same shape Customermates documents for n8n):
 *  - outbound: n8n consumes signed webhooks from the webhooks module
 *    (`X-Webhook-Signature` HMAC-SHA256 verification on the n8n side);
 *  - inbound: n8n (or Zapier/Make/custom) posts to trigger endpoints with a
 *    bearer token, which lands on routines / workflows through this service.
 */

import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { RoutinesService } from "../routines/routines.service";
import { WebhookDeliveryService } from "../webhooks/webhook-delivery.service";
import {
	buildDeliverWebhookWorkflow,
	type DeliverWebhookWorkflow,
} from "../workflows/deliver-webhook.workflow";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";
import { WorkflowRegistry } from "../workflows/workflow-registry.service";
import { WorkflowRunner } from "../workflows/workflow-runner.service";

export type N8nEventTriggerInput = {
	event: string;
	entityId?: string;
	changedFields?: string[];
	payload?: Record<string, unknown>;
};

export type N8nTriggerResult = {
	accepted: true;
	triggerId: string;
	queuedRoutineRuns: string[];
};

@Injectable()
export class N8nService {
	private readonly deliverWorkflow: DeliverWebhookWorkflow;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly routines: RoutinesService,
		private readonly runner: WorkflowRunner,
		registry: WorkflowRegistry,
		delivery: WebhookDeliveryService,
	) {
		this.deliverWorkflow = buildDeliverWebhookWorkflow(delivery);
		if (!registry.has(this.deliverWorkflow.name)) {
			registry.register(this.deliverWorkflow);
		}
	}

	/** Inbound event from n8n fans out to matching event-routines. */
	async triggerEvent(
		ownerUserId: string,
		input: N8nEventTriggerInput,
	): Promise<N8nTriggerResult> {
		if (input.event.trim().length === 0) {
			throw new WorkflowNonRetryableError("event is required");
		}

		const queuedRoutineRuns = await this.routines.dispatchEvent(ownerUserId, {
			event: input.event,
			changedFields: input.changedFields,
			at: new Date(),
		});

		return {
			accepted: true,
			triggerId: randomUUID(),
			queuedRoutineRuns,
		};
	}

	/** Manual routine trigger from n8n. */
	async triggerRoutine(
		routineId: string,
		ownerUserId: string,
	): Promise<{ queuedRunId: string }> {
		const routine = await this.db.routine.findUnique({
			where: { id: routineId },
		});
		if (!routine)
			throw new WorkflowNonRetryableError(`No routine with id ${routineId}`);
		const queuedRunId = await this.routines.triggerManually(
			routineId,
			ownerUserId,
		);
		return { queuedRunId };
	}

	/**
	 * Send a test event through a webhook subscription so an n8n flow can be
	 * verified end to end from the CRM side.
	 */
	async sendTestDelivery(
		webhookId: string,
	): Promise<{ deliveryId: string; dispatched: true }> {
		const webhook = await this.db.webhook.findUnique({
			where: { id: webhookId },
		});
		if (!webhook)
			throw new WorkflowNonRetryableError(`No webhook with id ${webhookId}`);

		const delivery = await this.db.webhookDelivery.create({
			data: {
				id: randomUUID(),
				webhookId: webhook.id,
				ownerUserId: webhook.ownerUserId,
				url: webhook.url,
				event: "webhook.test",
				requestBody: {
					event: "webhook.test",
					data: { entityId: webhook.id, payload: { test: true } },
					timestamp: new Date().toISOString(),
				},
			},
		});

		await this.runner.run(
			this.deliverWorkflow,
			{
				deliveryId: delivery.id,
				url: webhook.url,
				ownerUserId: webhook.ownerUserId,
				requestBody: {
					event: "webhook.test",
					data: { entityId: webhook.id, payload: { test: true } },
					timestamp: new Date().toISOString(),
				},
			},
			{ tenant: { userId: webhook.ownerUserId ?? undefined } },
		);

		return { deliveryId: delivery.id, dispatched: true };
	}
}
