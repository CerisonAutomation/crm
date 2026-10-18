/**
 * Inbound automation triggers (n8n, Zapier, Make, custom workers).
 *
 * Every route requires `Authorization: Bearer <CRON_SECRET or N8N_TRIGGER_TOKEN>`
 * — the same shared-secret pattern Customermates uses for `/api/cron/routines`.
 */

import {
	Body,
	Controller,
	ForbiddenException,
	Headers,
	Param,
	Post,
	Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { N8nService, type N8nEventTriggerInput } from "./n8n.service";

export function automationBearerValid(header: string | undefined): boolean {
	if (!header || !header.toLowerCase().startsWith("bearer ")) return false;
	const presented = header.slice("bearer ".length).trim();
	const secrets = [process.env.N8N_TRIGGER_TOKEN, process.env.CRON_SECRET].filter(
		(value): value is string => typeof value === "string" && value.length >= 16,
	);
	if (secrets.length === 0 || presented.length === 0) return false;

	let matched = false;
	for (const secret of secrets) {
		if (presented.length === secret.length) {
			let diff = 0;
			for (let index = 0; index < secret.length; index += 1) {
				diff |= presented.charCodeAt(index) ^ secret.charCodeAt(index);
			}
			if (diff === 0) matched = true;
		}
	}
	return matched;
}

function requireAutomationAuth(header: string | undefined): void {
	if (!automationBearerValid(header)) {
		throw new ForbiddenException(
			"Automation endpoints require Authorization: Bearer <N8N_TRIGGER_TOKEN or CRON_SECRET> (min 16 chars)",
		);
	}
}

@ApiTags("n8n")
@Controller("api/n8n")
export class N8nController {
	constructor(private readonly n8n: N8nService) {}

	@Post("triggers/events")
	@ApiOperation({ summary: "Post an automation event; matching event-routines are queued" })
	@ApiBearerAuth()
	async triggerEvent(
		@Body() body: N8nEventTriggerInput,
		@Headers("authorization") authorization: string | undefined,
		@Req() req: Request,
	) {
		requireAutomationAuth(authorization);
		const ownerUserId = this.resolveOwner(req);
		return this.n8n.triggerEvent(ownerUserId, body);
	}

	@Post("triggers/routines/:routineId")
	@ApiOperation({ summary: "Queue a manual routine run from an automation flow" })
	@ApiBearerAuth()
	async triggerRoutine(
		@Param("routineId") routineId: string,
		@Headers("authorization") authorization: string | undefined,
		@Req() req: Request,
	) {
		requireAutomationAuth(authorization);
		const ownerUserId = this.resolveOwner(req);
		return this.n8n.triggerRoutine(routineId, ownerUserId);
	}

	@Post("actions/webhooks/:webhookId/test")
	@ApiOperation({ summary: "Send a webhook.test delivery through an existing subscription" })
	@ApiBearerAuth()
	async testWebhook(
		@Param("webhookId") webhookId: string,
		@Headers("authorization") authorization: string | undefined,
	) {
		requireAutomationAuth(authorization);
		return this.n8n.sendTestDelivery(webhookId);
	}

	private resolveOwner(req: Request): string {
		const owner = req.headers["x-owner-user-id"];
		if (typeof owner === "string" && owner.length > 0) return owner;
		const fallback = process.env.N8N_DEFAULT_OWNER_USER_ID;
		if (fallback && fallback.length > 0) return fallback;
		throw new ForbiddenException(
			"Set the X-Owner-User-Id header or N8N_DEFAULT_OWNER_USER_ID so the trigger knows whose routines to match",
		);
	}
}
