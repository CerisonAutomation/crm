/**
 * Failure reporting for workflow runs (extracted from Customermates
 * `workflows/capture-failure.ts`). Reporting steps never retry: a broken
 * reporter must not take a workflow down with it.
 */

import { Logger } from "@nestjs/common";
import { toWorkflowFailure, type WorkflowFailure, type WorkflowTenant } from "./workflow-errors";

const REPORT_FLUSH_MS = 2000;

type SentryScope = {
	setContext: (key: string, context: Record<string, unknown>) => void;
	setUser: (user: { id?: string }) => void;
	setTag: (key: string, value: string) => void;
	setLevel: (level: string) => void;
};

type SentryClient = {
	withScope: (fn: (scope: SentryScope) => void) => void;
	captureException: (error: Error) => void;
	captureMessage: (message: string) => void;
	flush: (timeout: number) => Promise<boolean>;
};

let sentryClient: SentryClient | null = null;

/**
 * Wire an optional Sentry client. Without one, failures are logged through
 * Nest's logger, which is the correct behavior for self-hosted deployments.
 */
export function setWorkflowSentryClient(client: SentryClient | null): void {
	sentryClient = client;
}

function attachTenant(scope: SentryScope, tenant?: WorkflowTenant): void {
	if (tenant?.userId) scope.setUser({ id: tenant.userId });
	if (tenant?.companyId) scope.setTag("companyId", tenant.companyId);
}

async function flushSafely(logger: Logger): Promise<void> {
	if (!sentryClient) return;
	try {
		await sentryClient.flush(REPORT_FLUSH_MS);
	} catch (reportingError) {
		logger.error(
			{
				message: "Workflow failure reporting could not flush",
				cause: reportingError instanceof Error ? reportingError.message : String(reportingError),
			},
		);
	}
}

export async function reportFailure(
	workflowName: string,
	failure: WorkflowFailure,
	tenant?: WorkflowTenant,
): Promise<void> {
	const logger = new Logger(`workflow:${workflowName}`);
	const error = new Error(failure.message || "Workflow failed");
	if (failure.name) error.name = failure.name;
	if (failure.stack) error.stack = failure.stack;

	if (!sentryClient || process.env.NODE_ENV !== "production") {
		logger.error({
			message: error.message,
			name: error.name,
			expected: failure.expected === true,
			tenantUserId: tenant?.userId,
		});
		return;
	}

	if (failure.expected) return;

	try {
		sentryClient.withScope((scope) => {
			scope.setContext("workflow", { workflowName });
			attachTenant(scope, tenant);
			sentryClient?.captureException(error);
		});
		await flushSafely(logger);
	} catch (reportingError) {
		logger.error({
			message: "Workflow failure reporting failed",
			cause: reportingError instanceof Error ? reportingError.message : String(reportingError),
		});
	}
}

export async function reportWarning(
	workflowName: string,
	message: string,
	tenant?: WorkflowTenant,
): Promise<void> {
	const logger = new Logger(`workflow:${workflowName}`);

	if (!sentryClient || process.env.NODE_ENV !== "production") {
		logger.warn({
			message,
			tenantUserId: tenant?.userId,
		});
		return;
	}

	try {
		sentryClient.withScope((scope) => {
			scope.setContext("workflow", { workflowName });
			scope.setLevel("warning");
			attachTenant(scope, tenant);
			sentryClient?.captureMessage(message);
		});
		await flushSafely(logger);
	} catch (reportingError) {
		logger.error({
			message: "Workflow warning reporting failed",
			cause: reportingError instanceof Error ? reportingError.message : String(reportingError),
		});
	}
}
