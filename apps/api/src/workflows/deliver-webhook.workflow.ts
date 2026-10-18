/**
 * deliver-webhook workflow (extracted from Customermates `workflows/deliver-webhook.ts`).
 *
 * One delivery attempt = one step with `maxRetries = 5`. Retry policy follows
 * the failure taxonomy: 5xx/408/425/429/network retry, other 4xx throw
 * `WebhookNonRetryableFailure` and stop immediately. Expected failures end the
 * workflow quietly (the delivery row already records the outcome).
 */

import { reportFailure } from "./capture-failure";
import {
	isExpectedError,
	RETRYABLE_4XX,
	toWorkflowFailure,
	WebhookExternalFailure,
	WebhookNonRetryableFailure,
	type WorkflowTenant,
} from "./workflow-errors";
import type { WorkflowRunner } from "./workflow-runner.service";

export const WEBHOOK_PREFLIGHT_FAILURE_STATUS = 422;

export type DeliverWebhookPayload = {
	deliveryId: string;
	url: string;
	ownerUserId: string | null;
	requestBody: Record<string, unknown>;
};

export type DeliveryOutcome = {
	status: "success" | "failed";
	statusCode: number | null;
	responseMessage: string | null;
};

export type DeliverWebhookPort = {
	deliver(payload: DeliverWebhookPayload): Promise<DeliveryOutcome>;
};

const WORKFLOW_NAME = "deliver-webhook";
const DELIVER_STEP_MAX_RETRIES = 5;

export function classifyDeliveryFailure(
	outcome: DeliveryOutcome,
): Error | null {
	if (outcome.status === "success") return null;

	const code = outcome.statusCode;
	const nonRetryable =
		code !== null && code >= 400 && code < 500 && !RETRYABLE_4XX.has(code);

	if (nonRetryable)
		return new WebhookNonRetryableFailure(code, outcome.responseMessage);
	return new WebhookExternalFailure(code, outcome.responseMessage);
}

export type DeliverWebhookWorkflowPayload = DeliverWebhookPayload & {
	tenant?: WorkflowTenant;
};

export function buildDeliverWebhookWorkflow(port: DeliverWebhookPort) {
	return {
		name: WORKFLOW_NAME,
		async handler(
			payload: DeliverWebhookWorkflowPayload,
			step: import("./workflow-runner.service").StepExecutor,
		): Promise<DeliveryOutcome> {
			const { tenant, ...delivery } = payload;

			try {
				return await step(
					"deliverStep",
					{ maxRetries: DELIVER_STEP_MAX_RETRIES },
					async () => {
						const outcome = await port.deliver(delivery);
						const failure = classifyDeliveryFailure(outcome);
						if (failure) throw failure;
						return outcome;
					},
				);
			} catch (err) {
				if (isExpectedError(err)) {
					if (
						err instanceof WebhookNonRetryableFailure ||
						err instanceof WebhookExternalFailure
					) {
						return {
							status: "failed",
							statusCode: err.statusCode,
							responseMessage: err.message,
						};
					}
				}
				await reportFailure(WORKFLOW_NAME, toWorkflowFailure(err), tenant);
				throw err;
			}
		},
	};
}

export type DeliverWebhookWorkflow = ReturnType<
	typeof buildDeliverWebhookWorkflow
>;

export async function runDeliverWebhookWorkflow(
	runner: WorkflowRunner,
	workflow: DeliverWebhookWorkflow,
	payload: DeliverWebhookWorkflowPayload,
): Promise<ReturnType<WorkflowRunner["run"]>> {
	return runner.run(workflow, payload, { tenant: payload.tenant });
}
