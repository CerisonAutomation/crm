/**
 * Workflow ledger (pattern harvested from SeldonFrame U9: workflow-step-results
 * + workflow-event-log).
 *
 * Append-only event log plus per-step-attempt result payloads, both truncated
 * through `storage-caps` before persistence (Postiz Temporal discipline).
 * The log is the debuggable record waits reference (`resumedByRunEventId`).
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { InjectDatabase } from "../database/database.constants";
import { capJson, truncateText } from "./storage-caps";

export type LedgerEventKind =
	| "run.created"
	| "run.started"
	| "run.succeeded"
	| "run.failed"
	| "run.abandoned"
	| "step.started"
	| "step.succeeded"
	| "step.failed"
	| "step.retrying"
	| "gate.wait_registered"
	| "gate.wait_resumed"
	| "gate.approval_requested"
	| "gate.approval_resolved"
	| "resumable.yielded"
	| "resumable.completed";

const LEDGER_EVENT_KINDS = new Set<string>([
	"run.created",
	"run.started",
	"run.succeeded",
	"run.failed",
	"run.abandoned",
	"step.started",
	"step.succeeded",
	"step.failed",
	"step.retrying",
	"gate.wait_registered",
	"gate.wait_resumed",
	"gate.approval_requested",
	"gate.approval_resolved",
	"resumable.yielded",
	"resumable.completed",
]);

export type StepResultInput = {
	runId: string;
	stepName: string;
	attempt: number;
	status: "succeeded" | "failed" | "skipped";
	input?: unknown;
	output?: unknown;
	error?: string;
};

@Injectable()
export class WorkflowLedgerService {
	private readonly logger = new Logger(WorkflowLedgerService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async appendEvent(input: {
		runId: string;
		stepName?: string | null;
		kind: LedgerEventKind | string;
		payload?: Record<string, unknown>;
	}): Promise<string> {
		if (!LEDGER_EVENT_KINDS.has(input.kind)) {
			throw new Error(`Unknown ledger event kind ${input.kind}`);
		}
		const id = randomUUID();
		await this.db.workflowEventLog.create({
			data: {
				id,
				runId: input.runId,
				stepName: input.stepName ?? null,
				kind: input.kind,
				payload: capJson(input.payload ?? {}) as Prisma.InputJsonValue,
			},
		});
		return id;
	}

	async recordStepResult(input: StepResultInput): Promise<void> {
		try {
			await this.db.workflowStepResult.create({
				data: {
					id: randomUUID(),
					runId: input.runId,
					stepName: input.stepName,
					attempt: input.attempt,
					status: input.status,
					...(input.input === undefined
					? {}
					: { input: capJson(input.input) as Prisma.InputJsonValue }),
					...(input.output === undefined
						? {}
						: { output: capJson(input.output) as Prisma.InputJsonValue }),
					error: input.error ? truncateText(input.error) : null,
				},
			});
		} catch (error) {
			// The ledger must never break the run it documents.
			this.logger.warn(`Failed to record step result: ${String(error)}`);
		}
	}

	async eventsForRun(runId: string) {
		return this.db.workflowEventLog.findMany({
			where: { runId },
			orderBy: { createdAt: "asc" },
		});
	}

	async stepResultsForRun(runId: string) {
		return this.db.workflowStepResult.findMany({
			where: { runId },
			orderBy: { createdAt: "asc" },
		});
	}
}
