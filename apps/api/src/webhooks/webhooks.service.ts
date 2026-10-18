/**
 * Webhook subscriptions: CRUD + event dispatch.
 *
 * Dispatch creates the `WebhookDelivery` journal row and hands the actual
 * delivery to the `deliver-webhook` workflow so retries, backoff and failure
 * reporting live in one place (the workflow engine).
 */

import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	buildDeliverWebhookWorkflow,
	type DeliverWebhookWorkflow,
	type DeliverWebhookWorkflowPayload,
} from "../workflows/deliver-webhook.workflow";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";
import { WorkflowRegistry } from "../workflows/workflow-registry.service";
import { WorkflowRunner } from "../workflows/workflow-runner.service";
import {
	isRenderableWebhookBodyTemplate,
	WEBHOOK_BODY_TEMPLATE_MAX_CHARS,
} from "./webhook-body-template";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import {
	buildWebhookEventEnvelope,
	isWebhookEventName,
	WEBHOOK_EVENTS,
	type WebhookEventName,
} from "./webhook-events";
import {
	allowsCredentialedHeaders,
	validateWebhookHeaders,
} from "./webhook-headers";

export type WebhookInput = {
	url: string;
	description?: string | null;
	events: string[];
	secret?: string | null;
	headers?: Record<string, string> | null;
	bodyTemplate?: string | null;
	enabled?: boolean;
};

export type WebhookRecord = {
	id: string;
	url: string;
	description: string | null;
	events: string[];
	secret: string | null;
	headers: Record<string, string>;
	bodyTemplate: string | null;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
};

@Injectable()
export class WebhooksService {
	private readonly deliverWorkflow: DeliverWebhookWorkflow;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly runner: WorkflowRunner,
		registry: WorkflowRegistry,
		delivery: WebhookDeliveryService,
	) {
		this.deliverWorkflow = buildDeliverWebhookWorkflow(delivery);
		if (!registry.has(this.deliverWorkflow.name)) {
			registry.register(this.deliverWorkflow);
		}
	}

	static validateInput(input: WebhookInput): string[] {
		const problems: string[] = [];

		if (input.url.trim().length === 0) {
			problems.push("url is required");
		} else {
			try {
				const parsed = new URL(input.url);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
					problems.push("url must use http or https");
				}
			} catch {
				problems.push("url is not a valid URL");
			}
		}

		const unknownEvents = input.events.filter(
			(event) => !isWebhookEventName(event),
		);
		if (input.events.length === 0)
			problems.push("subscribe to at least one event");
		if (unknownEvents.length > 0)
			problems.push(`unknown events: ${unknownEvents.join(", ")}`);

		if (input.headers) {
			for (const issue of validateWebhookHeaders(input.headers)) {
				problems.push(`header problem: ${issue}`);
			}
			if (
				Object.keys(input.headers).length > 0 &&
				!allowsCredentialedHeaders(input.url) &&
				input.url.trim().length > 0
			) {
				problems.push(
					"custom headers require an https url or a loopback http url",
				);
			}
		}

		if (input.bodyTemplate != null) {
			if (input.bodyTemplate.length > WEBHOOK_BODY_TEMPLATE_MAX_CHARS) {
				problems.push("body template is too large");
			} else if (!isRenderableWebhookBodyTemplate(input.bodyTemplate)) {
				problems.push("body template does not render to a JSON object");
			}
		}

		return problems;
	}

	async create(
		ownerUserId: string,
		input: WebhookInput,
	): Promise<WebhookRecord> {
		const problems = WebhooksService.validateInput(input);
		if (problems.length > 0)
			throw new WorkflowNonRetryableError(problems.join("; "));

		const created = await this.db.webhook.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				url: input.url,
				description: input.description ?? null,
				events: input.events,
				secret: input.secret ?? null,
				headers: (input.headers ?? {}) as object,
				bodyTemplate: input.bodyTemplate ?? null,
				enabled: input.enabled ?? true,
			},
		});
		return this.toRecord(created);
	}

	async update(id: string, input: WebhookInput): Promise<WebhookRecord> {
		const problems = WebhooksService.validateInput(input);
		if (problems.length > 0)
			throw new WorkflowNonRetryableError(problems.join("; "));

		const updated = await this.db.webhook.update({
			where: { id },
			data: {
				url: input.url,
				description: input.description ?? null,
				events: input.events,
				secret: input.secret ?? null,
				headers: (input.headers ?? {}) as object,
				bodyTemplate: input.bodyTemplate ?? null,
				enabled: input.enabled ?? true,
			},
		});
		return this.toRecord(updated);
	}

	async remove(id: string): Promise<void> {
		await this.db.webhook.delete({ where: { id } });
	}

	async list(ownerUserId: string): Promise<WebhookRecord[]> {
		const rows = await this.db.webhook.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
		return rows.map((row) => this.toRecord(row));
	}

	async listDeliveries(ownerUserId: string, limit = 50) {
		return this.db.webhookDelivery.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
			take: Math.min(limit, 200),
		});
	}

	/**
	 * Fires `event` at every enabled subscriber. Returns the delivery ids that
	 * were dispatched (each runs through the deliver-webhook workflow).
	 */
	async dispatch(
		event: WebhookEventName,
		ownerUserId: string,
		entityId: string,
		payload: Record<string, unknown>,
		userId?: string,
	): Promise<string[]> {
		if (!isWebhookEventName(event)) {
			throw new WorkflowNonRetryableError(`Unknown webhook event ${event}`);
		}

		const subscribers = await this.db.webhook.findMany({
			where: { enabled: true, ownerUserId, events: { has: event } },
		});

		const envelope = buildWebhookEventEnvelope(
			event,
			entityId,
			payload,
			userId,
		);
		const deliveryIds: string[] = [];

		for (const webhook of subscribers) {
			const delivery = await this.db.webhookDelivery.create({
				data: {
					id: randomUUID(),
					webhookId: webhook.id,
					ownerUserId,
					url: webhook.url,
					event,
					requestBody: envelope as object,
				},
			});
			deliveryIds.push(delivery.id);

			const workflowPayload: DeliverWebhookWorkflowPayload = {
				deliveryId: delivery.id,
				url: webhook.url,
				ownerUserId,
				requestBody: envelope as unknown as Record<string, unknown>,
				tenant: { userId: ownerUserId },
			};
			await this.runner.run(this.deliverWorkflow, workflowPayload, {
				tenant: { userId: ownerUserId },
			});
		}

		return deliveryIds;
	}

	static availableEvents(): readonly string[] {
		return WEBHOOK_EVENTS;
	}

	private toRecord(row: {
		id: string;
		url: string;
		description: string | null;
		events: string[];
		secret: string | null;
		headers: unknown;
		bodyTemplate: string | null;
		enabled: boolean;
		createdAt: Date;
		updatedAt: Date;
	}): WebhookRecord {
		const headers =
			row.headers &&
			typeof row.headers === "object" &&
			!Array.isArray(row.headers)
				? (row.headers as Record<string, string>)
				: {};
		return {
			id: row.id,
			url: row.url,
			description: row.description,
			events: row.events,
			secret: row.secret,
			headers,
			bodyTemplate: row.bodyTemplate,
			enabled: row.enabled,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}
