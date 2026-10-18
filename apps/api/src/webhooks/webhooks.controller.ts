/**
 * Webhook subscription CRUD + dispatch testing, session-authenticated.
 */

import type { auth } from "@crm/auth";
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";
import { WEBHOOK_EVENTS } from "./webhook-events";
import { type WebhookInput, WebhooksService } from "./webhooks.service";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Webhooks")
@Controller("api/webhooks")
export class WebhooksController {
	constructor(private readonly webhooks: WebhooksService) {}

	@Get("events")
	@ApiOperation({ summary: "List the event names a webhook can subscribe to" })
	listEvents() {
		return { events: WEBHOOK_EVENTS };
	}

	@Get()
	@ApiOperation({ summary: "List your webhook subscriptions" })
	async list(@Session() session: CrmSession) {
		const ownerUserId = session.user.id;
		return { webhooks: await this.webhooks.list(ownerUserId) };
	}

	@Get("deliveries")
	@ApiOperation({ summary: "Recent delivery journal entries" })
	async deliveries(
		@Session() session: CrmSession,
		@Query("limit") limit?: string,
	) {
		const ownerUserId = session.user.id;
		const parsedLimit = limit ? Number.parseInt(limit, 10) : 50;
		const safeLimit =
			Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
		return {
			deliveries: await this.webhooks.listDeliveries(ownerUserId, safeLimit),
		};
	}

	@Post()
	@ApiOperation({ summary: "Create a webhook subscription" })
	async create(@Session() session: CrmSession, @Body() body: WebhookInput) {
		const ownerUserId = session.user.id;
		try {
			return { webhook: await this.webhooks.create(ownerUserId, body) };
		} catch (error) {
			throw this.toHttpException(error);
		}
	}

	@Put(":id")
	@ApiOperation({ summary: "Update a webhook subscription" })
	async update(
		@Session() session: CrmSession,
		@Param("id") id: string,
		@Body() body: WebhookInput,
	) {
		const ownerUserId = session.user.id;
		const existing = (await this.webhooks.list(ownerUserId)).find(
			(webhook) => webhook.id === id,
		);
		if (!existing) throw new NotFoundException(`No webhook with id ${id}`);
		try {
			return { webhook: await this.webhooks.update(id, body) };
		} catch (error) {
			throw this.toHttpException(error);
		}
	}

	@Delete(":id")
	@ApiOperation({ summary: "Delete a webhook subscription" })
	async remove(@Session() session: CrmSession, @Param("id") id: string) {
		const ownerUserId = session.user.id;
		const existing = (await this.webhooks.list(ownerUserId)).find(
			(webhook) => webhook.id === id,
		);
		if (!existing) throw new NotFoundException(`No webhook with id ${id}`);
		await this.webhooks.remove(id);
		return { deleted: true };
	}

	private toHttpException(error: unknown): Error {
		if (error instanceof WorkflowNonRetryableError) {
			return new BadRequestException(error.message);
		}
		return error instanceof Error ? error : new Error(String(error));
	}
}
