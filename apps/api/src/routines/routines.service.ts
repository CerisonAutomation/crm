/**
 * Routines — the automation scheduler (extracted from Customermates
 * `Routine`/`RoutineRun` models + `routines-tick`).
 *
 * Three trigger kinds:
 *  - `manual`   — dispatched on demand (UI, MCP tool, n8n);
 *  - `cron`     — `nextRunAt` maintained from the cron expression + timezone;
 *  - `event`    — fired by matching webhook-style events (`triggerEvents`,
 *                 optional `changedFields` filter) with debounce suppression.
 *
 * The tick (invoked by `POST /api/cron/routines` with the cron secret) starts
 * every due run through the `run-routine` workflow, then advances `nextRunAt`.
 */

import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { WorkflowRegistry } from "../workflows/workflow-registry.service";
import { WorkflowRunner } from "../workflows/workflow-runner.service";
import {
	buildRunRoutineWorkflow,
	type RunRoutineWorkflow,
	type RunRoutineWorkflowPayload,
} from "../workflows/run-routine.workflow";
import {
	buildReconcileRoutineRunsWorkflow,
	type ReconcileRoutineRunsWorkflow,
	type ReconcileRoutineRunsWorkflowPayload,
} from "../workflows/reconcile-routine-runs.workflow";
import { isValidCron, isValidTimeZone, nextCronRun } from "./cron-expression";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

export type RoutineInput = {
	name: string;
	prompt: string;
	enabled?: boolean;
	triggerKind: "manual" | "cron" | "event";
	cronExpression?: string | null;
	timezone?: string;
	triggerEvents?: string[];
	changedFields?: string[];
	debounceSeconds?: number;
};

export type EventTriggerMatch = {
	event: string;
	changedFields?: string[];
	at: Date;
};

export type RoutineRecord = {
	id: string;
	name: string;
	prompt: string;
	enabled: boolean;
	triggerKind: "manual" | "cron" | "event";
	cronExpression: string | null;
	timezone: string;
	triggerEvents: string[];
	changedFields: string[];
	debounceSeconds: number;
	nextRunAt: Date | null;
	lastRunAt: Date | null;
	lastRunStatus: string | null;
	disabledReason: string | null;
};

@Injectable()
export class RoutinesService {
	private readonly runRoutineWorkflow: RunRoutineWorkflow;
	private readonly reconcileWorkflow: ReconcileRoutineRunsWorkflow;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly runner: WorkflowRunner,
		registry: WorkflowRegistry,
	) {
		this.runRoutineWorkflow = buildRunRoutineWorkflow({
			startRoutineRun: async ({ routineRunId, ownerUserId }) => {
				await this.db.routineRun.update({
					where: { id: routineRunId },
					data: {
						status: "running",
						startedAt: new Date(),
						executedByUserId: ownerUserId,
					},
				});
			},
			failRoutineRun: async ({ routineRunId, reason }) => {
				await this.db.routineRun.update({
					where: { id: routineRunId },
					data: {
						status: "failed",
						finishedAt: new Date(),
						failureReason: reason,
					},
				});
			},
		});
		registry.register(this.runRoutineWorkflow);

		this.reconcileWorkflow = buildReconcileRoutineRunsWorkflow({
			normalizeExpiredWorkflowRuns: async (asOf) => {
				const cutoff = new Date(asOf.getTime() - 5 * 60_000);
				return this.runner.abandonStaleRuns(cutoff);
			},
			settleRoutineRuns: async ({ asOf }) => {
				const stale = await this.db.routineRun.updateMany({
					where: {
						status: { in: ["queued", "running"] },
						scheduledFor: { lt: new Date(asOf.getTime() - 24 * 60 * 60_000) },
					},
					data: {
						status: "failed",
						finishedAt: new Date(),
						failureReason: "orphanedRun",
					},
				});
				return stale.count;
			},
		});
		registry.register(this.reconcileWorkflow);
	}

	static validateInput(input: RoutineInput): string[] {
		const problems: string[] = [];

		if (input.name.trim().length === 0) problems.push("name is required");
		if (input.prompt.trim().length === 0) problems.push("prompt is required");

		if (input.triggerKind === "cron") {
			if (!input.cronExpression || !isValidCron(input.cronExpression)) {
				problems.push("cron trigger needs a valid five-field cron expression");
			}
		} else if (input.cronExpression) {
			problems.push("cronExpression is only allowed for cron routines");
		}

		const timezone = input.timezone ?? "UTC";
		if (!isValidTimeZone(timezone)) problems.push(`unknown timezone ${timezone}`);

		if (input.triggerKind === "event") {
			if (!input.triggerEvents || input.triggerEvents.length === 0) {
				problems.push("event routines need at least one trigger event");
			}
		}

		if (input.debounceSeconds != null && (input.debounceSeconds < 0 || input.debounceSeconds > 86_400)) {
			problems.push("debounceSeconds must be between 0 and 86400");
		}

		return problems;
	}

	async create(ownerUserId: string, input: RoutineInput): Promise<RoutineRecord> {
		const problems = RoutinesService.validateInput(input);
		if (problems.length > 0) throw new WorkflowNonRetryableError(problems.join("; "));

		const timezone = input.timezone ?? "UTC";
		const nextRunAt =
			input.triggerKind === "cron" && input.cronExpression && input.enabled !== false
				? nextCronRun(input.cronExpression, new Date(), timezone)
				: null;

		const created = await this.db.routine.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				name: input.name,
				prompt: input.prompt,
				enabled: input.enabled ?? true,
				triggerKind: input.triggerKind,
				cronExpression: input.cronExpression ?? null,
				timezone,
				triggerEvents: input.triggerEvents ?? [],
				changedFields: input.changedFields ?? [],
				debounceSeconds: input.debounceSeconds ?? 300,
				nextRunAt,
			},
		});
		return this.toRecord(created);
	}

	async update(id: string, input: RoutineInput): Promise<RoutineRecord> {
		const problems = RoutinesService.validateInput(input);
		if (problems.length > 0) throw new WorkflowNonRetryableError(problems.join("; "));

		const timezone = input.timezone ?? "UTC";
		const enabled = input.enabled ?? true;
		const nextRunAt =
			input.triggerKind === "cron" && input.cronExpression && enabled
				? nextCronRun(input.cronExpression, new Date(), timezone)
				: null;

		const updated = await this.db.routine.update({
			where: { id },
			data: {
				name: input.name,
				prompt: input.prompt,
				enabled,
				triggerKind: input.triggerKind,
				cronExpression: input.cronExpression ?? null,
				timezone,
				triggerEvents: input.triggerEvents ?? [],
				changedFields: input.changedFields ?? [],
				debounceSeconds: input.debounceSeconds ?? 300,
				nextRunAt,
				disabledReason: enabled ? null : "disabledByOwner",
			},
		});
		return this.toRecord(updated);
	}

	async remove(id: string): Promise<void> {
		await this.db.routine.delete({ where: { id } });
	}

	async list(ownerUserId: string): Promise<RoutineRecord[]> {
		const rows = await this.db.routine.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
		return rows.map((row) => this.toRecord(row));
	}

	/**
	 * Event dispatch: every enabled event-routine whose triggers match receives
	 * a queued run, unless a recent run inside the debounce window suppresses it.
	 */
	async dispatchEvent(ownerUserId: string, match: EventTriggerMatch): Promise<string[]> {
		const routines = await this.db.routine.findMany({
			where: { ownerUserId, enabled: true, triggerKind: "event" },
		});

		const runIds: string[] = [];

		for (const routine of routines) {
			if (!this.matchesEventTrigger(routine, match)) continue;

			if (routine.debounceSeconds > 0) {
				const recent = await this.db.routineRun.findFirst({
					where: {
						routineId: routine.id,
						createdAt: { gte: new Date(match.at.getTime() - routine.debounceSeconds * 1000) },
					},
				});
				if (recent) continue;
			}

			const run = await this.enqueueRun(routine.id, ownerUserId, "event", {
				triggerEvent: match.event,
				triggerPayload: (match as unknown as Record<string, unknown>) ?? undefined,
			});
			runIds.push(run);
		}

		return runIds;
	}

	matchesEventTrigger(
		routine: { triggerEvents: string[]; changedFields: string[] },
		match: EventTriggerMatch,
	): boolean {
		if (!routine.triggerEvents.includes(match.event)) return false;

		// The field filter only applies when the event reports changed fields;
		// an event without that detail cannot be disproven, so it matches.
		if (routine.changedFields.length > 0 && match.changedFields && match.changedFields.length > 0) {
			const overlap = routine.changedFields.some((field) => (match.changedFields ?? []).includes(field));
			if (!overlap) return false;
		}

		return true;
	}

	/** Queues one routine run and dispatches the `run-routine` workflow. */
	async triggerManually(routineId: string, ownerUserId: string): Promise<string> {
		return this.enqueueRun(routineId, ownerUserId, "manual", {});
	}

	private async enqueueRun(
		routineId: string,
		ownerUserId: string | null,
		triggerKind: "manual" | "cron" | "event",
		extra: { triggerEvent?: string; triggerPayload?: Record<string, unknown> },
	): Promise<string> {
		const runId = randomUUID();
		const run = await this.db.routineRun.create({
			data: {
				id: runId,
				routineId,
				executedByUserId: ownerUserId,
				triggerKind,
				triggerEvent: extra.triggerEvent ?? null,
				triggerPayload: (extra.triggerPayload ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
				scheduledFor: new Date(),
			},
		});

		const payload: RunRoutineWorkflowPayload = {
			routineRunId: run.id,
			ownerUserId,
			tenant: { userId: ownerUserId ?? undefined },
		};
		await this.runner.run(this.runRoutineWorkflow, payload, {
			tenant: { userId: ownerUserId ?? undefined },
		});

		return run.id;
	}

	/**
	 * Cron tick: starts due cron runs and returns a summary for the caller
	 * (the endpoint's response body).
	 */
	async tick(now = new Date()): Promise<{ started: number; advanced: number; settled: number }> {
		const due = await this.db.routine.findMany({
			where: {
				enabled: true,
				triggerKind: "cron",
				nextRunAt: { lte: now },
			},
			orderBy: { nextRunAt: "asc" },
			take: 100,
		});

		let started = 0;
		let advanced = 0;

		for (const routine of due) {
			await this.enqueueRun(routine.id, routine.ownerUserId, "cron", {});
			started += 1;

			const next = routine.cronExpression
				? nextCronRun(routine.cronExpression, now, routine.timezone)
				: null;
			await this.db.routine.update({
				where: { id: routine.id },
				data: {
					nextRunAt: next,
					lastRunAt: now,
					lastRunStatus: "queued",
					...(next === null ? { enabled: false, disabledReason: "scheduleExhausted" } : {}),
				},
			});
			advanced += 1;
		}

		const reconcilePayload: ReconcileRoutineRunsWorkflowPayload = {
			ownerUserId: null,
		};
		const reconcile = await this.runner.run(this.reconcileWorkflow, reconcilePayload, {});
		const settled =
			reconcile.ok && typeof reconcile.result === "object" && reconcile.result !== null
				? (reconcile.result as { settledRuns: number }).settledRuns
				: 0;

		return { started, advanced, settled };
	}

	private toRecord(row: {
		id: string;
		name: string;
		prompt: string;
		enabled: boolean;
		triggerKind: "manual" | "cron" | "event";
		cronExpression: string | null;
		timezone: string;
		triggerEvents: string[];
		changedFields: string[];
		debounceSeconds: number;
		nextRunAt: Date | null;
		lastRunAt: Date | null;
		lastRunStatus: string | null;
		disabledReason: string | null;
	}): RoutineRecord {
		return {
			id: row.id,
			name: row.name,
			prompt: row.prompt,
			enabled: row.enabled,
			triggerKind: row.triggerKind,
			cronExpression: row.cronExpression,
			timezone: row.timezone,
			triggerEvents: row.triggerEvents,
			changedFields: row.changedFields,
			debounceSeconds: row.debounceSeconds,
			nextRunAt: row.nextRunAt,
			lastRunAt: row.lastRunAt,
			lastRunStatus: row.lastRunStatus,
			disabledReason: row.disabledReason,
		};
	}
}
