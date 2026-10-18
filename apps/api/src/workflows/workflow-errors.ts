/**
 * Workflow failure taxonomy (extracted from the Customermates workflow engine).
 *
 * Every workflow-side failure is classified before it reaches the runner:
 *  - `WebhookExternalFailure` — retryable transport/remote failure (5xx, 408, 425, 429, network).
 *  - `WebhookNonRetryableFailure` — remote rejected the request (other 4xx); retries cannot help.
 *  - `WorkflowNonRetryableError` — local precondition failed; retrying would repeat the same outcome.
 *  - anything else — retryable by default up to the step's `maxRetries`.
 */

export type WorkflowFailure = {
	name?: string;
	message?: string;
	stack?: string;
	expected?: boolean;
};

export type WorkflowTenant = {
	userId?: string;
	companyId?: string;
};

export class WorkflowNonRetryableError extends Error {
	readonly nonRetryable = true;

	constructor(message: string) {
		super(message);
		this.name = "WorkflowNonRetryableError";
	}
}

export class WebhookExternalFailure extends Error {
	readonly nonRetryable = false;
	readonly statusCode: number | null;

	constructor(statusCode: number | null, responseMessage: string | null) {
		super(
			statusCode === null
				? (responseMessage ?? "Webhook delivery failed")
				: `Webhook delivery failed with HTTP ${statusCode}: ${responseMessage ?? ""}`.trim(),
		);
		this.name = "WebhookExternalFailure";
		this.statusCode = statusCode;
	}
}

export class WebhookNonRetryableFailure extends Error {
	readonly nonRetryable = true;
	readonly statusCode: number;

	constructor(statusCode: number, responseMessage: string | null) {
		super(
			`Webhook endpoint rejected the delivery with HTTP ${statusCode}: ${responseMessage ?? ""}`.trim(),
		);
		this.name = "WebhookNonRetryableFailure";
		this.statusCode = statusCode;
	}
}

/** HTTP status codes in the 4xx range that still deserve a retry. */
export const RETRYABLE_4XX = new Set([408, 425, 429]);

export function isRetryableStatus(statusCode: number | null): boolean {
	if (statusCode === null) return true;
	if (statusCode >= 500) return true;
	if (statusCode >= 400 && statusCode < 500)
		return RETRYABLE_4XX.has(statusCode);
	return true;
}

type MaybeNonRetryable = { nonRetryable?: boolean };

export function isNonRetryable(error: unknown): boolean {
	if (error instanceof WorkflowNonRetryableError) return true;
	if (error instanceof WebhookNonRetryableFailure) return true;
	const flagged = error as MaybeNonRetryable | null;
	return (
		typeof flagged === "object" &&
		flagged !== null &&
		flagged.nonRetryable === true
	);
}

/**
 * Expected errors are handled outcomes: the workflow already recorded them
 * (e.g. a webhook delivery marked failed), so failure reporting stays silent.
 */
export function isExpectedError(error: unknown): boolean {
	return isNonRetryable(error) || error instanceof WebhookExternalFailure;
}

export function toWorkflowFailure(error: unknown): WorkflowFailure {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			expected: isExpectedError(error),
		};
	}
	return { message: String(error), expected: isExpectedError(error) };
}
