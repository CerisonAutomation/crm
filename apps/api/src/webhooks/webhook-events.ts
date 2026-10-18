/**
 * Event registry for outbound webhooks. Every event name that can appear in a
 * webhook subscription must be listed here; the API refuses subscriptions to
 * unknown events so n8n/Zapier flows cannot silently misspell a trigger.
 */

export const WEBHOOK_EVENTS = [
	"company.created",
	"company.updated",
	"company.deleted",
	"contact.created",
	"contact.updated",
	"contact.deleted",
	"deal.created",
	"deal.updated",
	"deal.deleted",
	"activity.created",
	"activity.updated",
	"activity.deleted",
	"routine.run.succeeded",
	"routine.run.failed",
	"workflow.run.failed",
	"channel.message.received",
	"booking.created",
	"booking.cancelled",
	"booking.completed",
	"agent.draft.created",
	"agent.draft.resolved",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_COUNT = WEBHOOK_EVENTS.length;

export function isWebhookEventName(value: string): value is WebhookEventName {
	return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export type WebhookEventEnvelope = {
	event: WebhookEventName;
	data: {
		userId?: string;
		entityId: string;
		payload: Record<string, unknown>;
	};
	timestamp: string;
};

export function buildWebhookEventEnvelope(
	event: WebhookEventName,
	entityId: string,
	payload: Record<string, unknown>,
	userId?: string,
): WebhookEventEnvelope {
	return {
		event,
		data: {
			userId,
			entityId,
			payload,
		},
		timestamp: new Date().toISOString(),
	};
}
