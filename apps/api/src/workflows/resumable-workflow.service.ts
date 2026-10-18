/**
 * Resumable workflows — durable pause/resume via explicit state machines.
 *
 * JavaScript closures cannot suspend mid-handler, so durable waits need the
 * workflow to be expressed as a state machine: `start` runs until it YIELDS
 * (an event wait or an approval gate); `resume` advances from the persisted
 * state when the gate resolves. State persistence rides the append-only
 * workflow ledger (`resumable.yielded` events) — no extra tables, and every
 * transition is auditable.
 *
 * Advancement is driven by the event dispatcher: a domain event that resumes
 * a WorkflowWait automatically advances every resumable run yielded on it.
 */

import type { Db, Prisma } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { capJson } from "./storage-caps";
import { WorkflowNonRetryableError } from "./workflow-errors";
import {
	type ApprovalTimeoutPolicy,
	type ResolvedPredicate,
	WorkflowGatesService,
} from "./workflow-gates.service";
import { WorkflowLedgerService } from "./workflow-ledger.service";

export type ResumeTrigger = {
	kind: "event" | "approval";
	eventName?: string;
	payload: Record<string, unknown>;
	decision?: "approved" | "rejected";
};

export type YieldedStep<TState> =
	| { kind: "done"; result: unknown }
	| {
			kind: "wait";
			state: TState;
			matchEvent: string;
			matchPredicate: ResolvedPredicate;
			timeoutMs: number;
	  }
	| {
			kind: "approval";
			state: TState;
			reason: string;
			timeoutMs: number;
			timeoutPolicy?: ApprovalTimeoutPolicy;
	  };

export type ResumableWorkflowDefinition<TState = unknown> = {
	name: string;
	start(input: unknown): Promise<YieldedStep<TState>>;
	resume(state: TState, trigger: ResumeTrigger): Promise<YieldedStep<TState>>;
};

export type ResumableRunHandle =
	| { status: "completed"; runId: string; result: unknown }
	| {
			status: "waiting";
			runId: string;
			gate: "wait" | "approval";
			gateId: string;
			matchEvent?: string;
	  };

const YIELDED_KIND = "resumable.yielded";
const COMPLETED_KIND = "resumable.completed";

type YieldedRecord = {
	state: unknown;
	gate: "wait" | "approval";
	gateId: string;
	matchEvent?: string;
};

@Injectable()
export class ResumableWorkflowService {
	private readonly logger = new Logger(ResumableWorkflowService.name);
	private readonly definitions = new Map<
		string,
		ResumableWorkflowDefinition<never>
	>();

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly gates: WorkflowGatesService,
		private readonly ledger: WorkflowLedgerService,
	) {}

	register<TState>(definition: ResumableWorkflowDefinition<TState>): void {
		if (this.definitions.has(definition.name)) {
			throw new WorkflowNonRetryableError(
				`Resumable workflow ${definition.name} already registered`,
			);
		}
		this.definitions.set(
			definition.name,
			definition as ResumableWorkflowDefinition<never>,
		);
	}

	registered(): string[] {
		return [...this.definitions.keys()];
	}

	/**
	 * Runs a definition to its first yield (or completion). The run id is the
	 * definition name + a ledger-backed audit trail.
	 */
	async runToYield(
		name: string,
		input: Record<string, unknown>,
		ownerUserId?: string,
	): Promise<ResumableRunHandle> {
		const definition = this.requireDefinition(name);
		const runId = await this.createRunRow(name, input, ownerUserId);
		const first = await definition.start(input);
		return this.applyYield(definition, runId, first);
	}

	/** Explicit advancement (also used by the event dispatcher). */
	async resume(
		runId: string,
		trigger: ResumeTrigger,
	): Promise<ResumableRunHandle> {
		const yielded = await this.latestYield(runId);
		if (!yielded)
			throw new WorkflowNonRetryableError(`Run ${runId} has no yielded state`);
		const run = await this.db.workflowRun.findUnique({ where: { id: runId } });
		if (!run) throw new WorkflowNonRetryableError(`No run ${runId}`);
		if (
			run.status === "succeeded" ||
			run.status === "failed" ||
			run.status === "abandoned"
		) {
			throw new WorkflowNonRetryableError(
				`Run ${runId} is already ${run.status}`,
			);
		}
		const definition = this.requireDefinition(run.workflowName);
		const next = await definition.resume(yielded.state as never, trigger);
		return this.applyYield(definition, runId, next);
	}

	/**
	 * Dispatcher hook: advances every run yielded on `matchEvent` whose frozen
	 * predicate the payload satisfies. Returns the run ids advanced.
	 */
	async resumeMatching(
		matchEvent: string,
		payload: Record<string, unknown>,
	): Promise<string[]> {
		const waits = await this.db.workflowWait.findMany({
			where: { matchEvent, status: "resumed", resumedReason: "event_match" },
			orderBy: { resumedAt: "desc" },
			take: 50,
		});
		const advanced: string[] = [];
		for (const wait of waits) {
			const runId = wait.runId;
			const run = await this.db.workflowRun.findUnique({
				where: { id: runId },
			});
			if (!run || run.status !== "running") continue;
			const yielded = await this.latestYield(runId);
			if (!yielded || yielded.gateId !== wait.id) continue;
			try {
				const handle = await this.resume(runId, {
					kind: "event",
					eventName: matchEvent,
					payload,
				});
				if (handle.status === "completed") advanced.push(runId);
			} catch (error) {
				this.logger.warn(
					`resumeMatching failed for run ${runId}: ${String(error)}`,
				);
			}
		}
		return advanced;
	}

	// ------------------------------------------------------------ internals

	private requireDefinition(name: string): ResumableWorkflowDefinition<never> {
		const definition = this.definitions.get(name);
		if (!definition)
			throw new WorkflowNonRetryableError(`No resumable workflow ${name}`);
		return definition;
	}

	private async createRunRow(
		name: string,
		input: Record<string, unknown>,
		ownerUserId?: string,
	): Promise<string> {
		const run = await this.db.workflowRun.create({
			data: {
				workflowName: name,
				tenantUserId: ownerUserId ?? null,
				status: "running",
				input: capJson(input) as Prisma.InputJsonValue,
				startedAt: new Date(),
			},
		});
		return run.id;
	}

	private async applyYield(
		definition: ResumableWorkflowDefinition<never>,
		runId: string,
		step: YieldedStep<never>,
	): Promise<ResumableRunHandle> {
		if (step.kind === "done") {
			await this.db.workflowRun.update({
				where: { id: runId },
				data: { status: "succeeded", finishedAt: new Date() },
			});
			await this.ledger.appendEvent({
				runId,
				kind: COMPLETED_KIND,
				payload: { result: capJson(step.result) as Record<string, unknown> },
			});
			return { status: "completed", runId, result: step.result };
		}

		if (step.kind === "wait") {
			const wait = await this.gates.registerWait({
				runId,
				stepName: `${definition.name}:wait`,
				matchEvent: step.matchEvent,
				matchPredicate: step.matchPredicate,
				timeoutAt: new Date(Date.now() + step.timeoutMs),
			});
			const record: YieldedRecord = {
				state: step.state,
				gate: "wait",
				gateId: wait.id,
				matchEvent: step.matchEvent,
			};
			await this.appendYielded(runId, record);
			return {
				status: "waiting",
				runId,
				gate: "wait",
				gateId: wait.id,
				matchEvent: step.matchEvent,
			};
		}

		const approval = await this.gates.requestApproval({
			runId,
			stepName: `${definition.name}:approval`,
			reason: step.reason,
			timeoutAt: new Date(Date.now() + step.timeoutMs),
			timeoutPolicy: step.timeoutPolicy ?? "abort",
		});
		const record: YieldedRecord = {
			state: step.state,
			gate: "approval",
			gateId: approval.id,
		};
		await this.appendYielded(runId, record);
		return { status: "waiting", runId, gate: "approval", gateId: approval.id };
	}

	private async appendYielded(
		runId: string,
		record: YieldedRecord,
	): Promise<void> {
		await this.ledger.appendEvent({
			runId,
			kind: YIELDED_KIND,
			payload: {
				state: capJson(record.state) as Record<string, unknown>,
				gate: record.gate,
				gateId: record.gateId,
				matchEvent: record.matchEvent ?? null,
			},
		});
	}

	private async latestYield(runId: string): Promise<YieldedRecord | null> {
		const row = await this.db.workflowEventLog.findFirst({
			where: { runId, kind: YIELDED_KIND },
			orderBy: { createdAt: "desc" },
		});
		if (!row) return null;
		const payload = row.payload as unknown as {
			state: unknown;
			gate: "wait" | "approval";
			gateId: string;
			matchEvent?: string | null;
		};
		return {
			state: payload.state,
			gate: payload.gate,
			gateId: payload.gateId,
			matchEvent: payload.matchEvent ?? undefined,
		};
	}
}
