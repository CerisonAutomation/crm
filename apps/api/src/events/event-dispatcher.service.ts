/**
 * Event dispatcher — the single seam every domain event flows through.
 *
 * One dispatch fans out to three independent consumers:
 *  1. routines (`RoutinesService.dispatchEvent`) — event-triggered automations;
 *  2. webhooks (`WebhooksService.dispatch`) — external subscriptions;
 *  3. workflow gates (`WorkflowGatesService.resumeByEvent`) — wakes any
 *     in-step `awaitEvent` waiters matching the event + frozen predicate.
 *
 * Fan-out isolation: every consumer runs through `Promise.allSettled`, so a
 * failing consumer (unknown webhook event, database hiccup) can never block
 * the others or the originating action. This is the linking layer that turns
 * the harvested modules from islands into one system.
 */

import { Injectable, Logger } from "@nestjs/common";
import { RoutinesService } from "../routines/routines.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { isWebhookEventName } from "../webhooks/webhook-events";
import { WorkflowGatesService } from "../workflows/workflow-gates.service";
import { ResumableWorkflowService } from "../workflows/resumable-workflow.service";

export type DomainEvent = {
	event: string;
	ownerUserId: string;
	entityId: string;
	payload: Record<string, unknown>;
	at: Date;
	changedFields?: string[];
};

export type DispatchReport = {
	event: string;
	entityId: string;
	routinesQueued: string[];
	webhookDeliveries: string[];
	waitsResumed: number;
	resumableAdvanced: number;
	failures: string[];
};

@Injectable()
export class EventDispatcherService {
	private readonly logger = new Logger(EventDispatcherService.name);

	constructor(
		private readonly routines: RoutinesService,
		private readonly webhooks: WebhooksService,
		private readonly gates: WorkflowGatesService,
		private readonly resumable?: ResumableWorkflowService,
	) {}

	async dispatch(event: DomainEvent): Promise<DispatchReport> {
		const report: DispatchReport = {
			event: event.event,
			entityId: event.entityId,
			routinesQueued: [],
			webhookDeliveries: [],
			waitsResumed: 0,
			resumableAdvanced: 0,
			failures: [],
		};

		const webhookFanOut = isWebhookEventName(event.event)
			? Promise.resolve(this.webhooks.dispatch(event.event, event.ownerUserId, event.entityId, event.payload))
			: Promise.resolve([] as string[]);

		const [routinesResult, webhooksResult, gatesResult] = await Promise.allSettled([
			this.routines.dispatchEvent(event.ownerUserId, {
				event: event.event,
				changedFields: event.changedFields ?? [],
				at: event.at,
			}),
			webhookFanOut,
			this.gates.resumeByEvent(event.event, event.payload),
		]);

		// Resumable advancement runs AFTER gate resolution so yielded runs see
		// their waits already CAS-resumed (deterministic ordering).
		let resumableResult: PromiseSettledResult<string[]>;
		if (this.resumable) {
			resumableResult = await Promise.allSettled([
				this.resumable.resumeMatching(event.event, event.payload),
			]).then(([result]) =>
				result.status === "fulfilled"
					? ({ status: "fulfilled", value: result.value } as PromiseSettledResult<string[]>)
					: ({ status: "rejected", reason: result.reason } as PromiseSettledResult<string[]>),
			);
		} else {
			resumableResult = { status: "fulfilled", value: [] };
		}

		if (routinesResult.status === "fulfilled") {
			report.routinesQueued = routinesResult.value;
		} else {
			report.failures.push(`routines: ${String(routinesResult.reason)}`);
			this.logger.warn(`routines fan-out failed for ${event.event}: ${String(routinesResult.reason)}`);
		}

		if (webhooksResult.status === "fulfilled") {
			report.webhookDeliveries = webhooksResult.value;
		} else {
			report.failures.push(`webhooks: ${String(webhooksResult.reason)}`);
			this.logger.warn(`webhooks fan-out failed for ${event.event}: ${String(webhooksResult.reason)}`);
		}

		if (gatesResult.status === "fulfilled") {
			report.waitsResumed = gatesResult.value ? 1 : 0;
		} else {
			report.failures.push(`gates: ${String(gatesResult.reason)}`);
			this.logger.warn(`gates fan-out failed for ${event.event}: ${String(gatesResult.reason)}`);
		}

		if (resumableResult.status === "fulfilled") {
			report.resumableAdvanced = resumableResult.value.length;
		} else {
			report.failures.push(`resumable: ${String(resumableResult.reason)}`);
			this.logger.warn(`resumable fan-out failed for ${event.event}: ${String(resumableResult.reason)}`);
		}

		return report;
	}
}
