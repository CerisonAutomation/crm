/**
 * Webhook delivery (extracted from Customermates
 * `features/webhook/deliver-webhook.interactor.ts`).
 *
 * Guarantees:
 *  - 5-second HTTP timeout with guaranteed `AbortController` cleanup;
 *  - `X-Webhook-Signature` = hex HMAC-SHA256 of the raw body when a secret set;
 *  - custom headers only travel to HTTPS or loopback endpoints;
 *  - body templates render through `renderWebhookBody` and a failed render is a
 *    preflight failure (422) without touching the network;
 *  - every attempt is journaled to `WebhookDelivery`.
 */

import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { type FetchLike, ssrfSafeFetch } from "../http/ssrf-safe-fetch";
import type {
	DeliverWebhookPayload,
	DeliverWebhookPort,
	DeliveryOutcome,
} from "../workflows/deliver-webhook.workflow";
import { WEBHOOK_PREFLIGHT_FAILURE_STATUS } from "../workflows/deliver-webhook.workflow";
import { renderWebhookBody } from "./webhook-body-template";
import {
	allowsCredentialedHeaders,
	parseStoredWebhookHeaders,
} from "./webhook-headers";
import {
	signWebhookPayload,
	WEBHOOK_SIGNATURE_HEADER,
} from "./webhook-signature";

const HTTP_TIMEOUT_MS = 5000;

@Injectable()
export class WebhookDeliveryService implements DeliverWebhookPort {
	private readonly logger = new Logger(WebhookDeliveryService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async deliver(payload: DeliverWebhookPayload): Promise<DeliveryOutcome> {
		const delivery = await this.db.webhookDelivery.findUnique({
			where: { id: payload.deliveryId },
			include: { webhook: true },
		});

		if (!delivery) {
			return {
				status: "failed",
				statusCode: null,
				responseMessage: `Delivery ${payload.deliveryId} no longer exists`,
			};
		}

		const headers = parseStoredWebhookHeaders(delivery.webhook?.headers ?? {});
		const secret = delivery.webhook?.secret ?? null;
		const bodyTemplate = delivery.webhook?.bodyTemplate ?? null;

		if (
			Object.keys(headers).length > 0 &&
			!allowsCredentialedHeaders(payload.url)
		) {
			return this.markFailed(payload.deliveryId, {
				status: "failed",
				statusCode: WEBHOOK_PREFLIGHT_FAILURE_STATUS,
				responseMessage: "Custom headers require an HTTPS endpoint",
			});
		}

		const rendered = bodyTemplate
			? renderWebhookBody(bodyTemplate, payload.requestBody)
			: null;

		if (rendered && !rendered.ok) {
			return this.markFailed(payload.deliveryId, {
				status: "failed",
				statusCode: WEBHOOK_PREFLIGHT_FAILURE_STATUS,
				responseMessage: `Body template could not be rendered (${rendered.reason})`,
			});
		}

		await this.db.webhookDelivery.update({
			where: { id: payload.deliveryId },
			data: { status: "processing", attemptCount: { increment: 1 } },
		});

		const outcome = await this.postWebhook({
			url: payload.url,
			secret,
			headers,
			requestBody: rendered ? rendered.body : payload.requestBody,
		});

		if (outcome.status === "success") {
			await this.db.webhookDelivery.update({
				where: { id: payload.deliveryId },
				data: {
					status: "success",
					statusCode: outcome.statusCode,
					responseMessage: outcome.responseMessage,
					deliveredAt: new Date(),
				},
			});
			return outcome;
		}

		return this.markFailed(payload.deliveryId, outcome);
	}

	private async markFailed(
		deliveryId: string,
		outcome: DeliveryOutcome,
	): Promise<DeliveryOutcome> {
		await this.db.webhookDelivery.update({
			where: { id: deliveryId },
			data: {
				status: "failed",
				statusCode: outcome.statusCode,
				responseMessage: outcome.responseMessage,
			},
		});
		return outcome;
	}

	private async postWebhook(args: {
		url: string;
		secret: string | null;
		headers: Record<string, string>;
		requestBody: unknown;
	}): Promise<DeliveryOutcome> {
		const body = JSON.stringify(args.requestBody);
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

		try {
			const signature = args.secret
				? signWebhookPayload(args.secret, body)
				: null;

			const headers: Record<string, string> = {
				...args.headers,
				"Content-Type": "application/json",
			};
			if (signature) {
				headers[WEBHOOK_SIGNATURE_HEADER] = signature;
			}
			const response = await ssrfSafeFetch(globalThis.fetch as FetchLike)(
				args.url,
				{
					method: "POST",
					signal: controller.signal,
					headers,
					body,
				},
			);

			return {
				status: response.ok ? "success" : "failed",
				statusCode: response.status,
				responseMessage: response.statusText,
			};
		} catch (error) {
			const responseMessage =
				error instanceof Error && error.name === "AbortError"
					? `Request timed out after ${HTTP_TIMEOUT_MS}ms`
					: error instanceof Error
						? error.message
						: "Network error";
			this.logger.warn({
				message: "Webhook delivery could not reach the endpoint",
				url: args.url,
				detail: responseMessage,
			});
			return { status: "failed", statusCode: null, responseMessage };
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
