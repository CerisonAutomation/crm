/**
 * Workflow gates: event waits and human approvals (patterns harvested from
 * SeldonFrame `workflow-waits` / `workflow-approvals`).
 *
 * Wait semantics (SeldonFrame design decisions preserved):
 *  - `matchPredicate` stores the RESOLVED predicate (values frozen at
 *    registration — no template interpolation at event time);
 *  - `timeoutAt` is absolute so the cron sweep is timestamp-comparison safe;
 *  - resume is compare-and-swap (`status = 'active'`) giving at-most-once
 *    advancement even under concurrent events;
 *  - `resumedReason` is an allowlist: event_match | timeout | manual | cancelled.
 *
 * Approval semantics:
 *  - resolution is compare-and-swap (`status = 'pending'`);
 *  - timeout policies: `abort` (-> timed_out) or `auto_approve`;
 *  - rows are kept on cancel for forensic value (never cascade-deleted early).
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { WorkflowNonRetryableError } from "./workflow-errors";

export type ResolvedPredicate = Record<
	string,
	string | number | boolean | null
>;

export type WaitRegistration = {
	runId: string;
	stepName: string;
	matchEvent: string;
	matchPredicate: ResolvedPredicate;
	timeoutAt?: Date | null;
};

export type WaitResumeReason =
	| "event_match"
	| "timeout"
	| "manual"
	| "cancelled";
export type ApprovalTimeoutPolicy = "abort" | "auto_approve";

export type ApprovalRequest = {
	runId: string;
	stepName: string;
	reason: string;
	payload?: Record<string, unknown>;
	approverHint?: string | null;
	requestedByUserId?: string | null;
	timeoutAt?: Date | null;
	timeoutPolicy?: ApprovalTimeoutPolicy;
};

export type GateDecision = "approved" | "rejected";

const RESUME_REASONS: readonly WaitResumeReason[] = [
	"event_match",
	"timeout",
	"manual",
	"cancelled",
];

/**
 * Frozen-predicate matcher: every key in the predicate must equal the same key
 * in the event payload (strict equality). An empty predicate matches any event
 * of the registered kind.
 */
export function predicateMatches(
	predicate: ResolvedPredicate,
	eventPayload: Record<string, unknown>,
): boolean {
	for (const [key, expected] of Object.entries(predicate)) {
		const actual = eventPayload[key];
		if (actual !== expected) return false;
	}
	return true;
}

export type AwaitEventResult = {
	waitId: string;
	resumed: boolean;
	reason: WaitResumeReason | null;
};

export type AwaitApprovalResult = {
	approvalId: string;
	status: "approved" | "rejected" | "timed_out" | "cancelled";
	resolvedByUserId: string | null;
};

/** Poll interval for step-level awaits (event emitter is the fast path). */
const AWAIT_POLL_MS = 150;

@Injectable()
export class WorkflowGatesService {
	/** Fast-path wakeups: resumeByEvent publishes here for in-step awaiters. */
	private readonly wake = new EventEmitter();

	constructor(@InjectDatabase() private readonly db: Db) {}

	// ---------------------------------------------------------------- waits

	async registerWait(registration: WaitRegistration) {
		const id = randomUUID();
		return this.db.workflowWait.create({
			data: {
				id,
				runId: registration.runId,
				stepName: registration.stepName,
				matchEvent: registration.matchEvent,
				matchPredicate: registration.matchPredicate as object,
				timeoutAt: registration.timeoutAt ?? null,
				status: "active",
			},
		});
	}

	/**
	 * Attempts to resume one active wait matching (event, predicate). The CAS
	 * update guarantees a single winner when events race; returns the resumed
	 * wait or null when nothing matched / already resumed.
	 */
	async resumeByEvent(
		matchEvent: string,
		eventPayload: Record<string, unknown>,
		runEventId?: string,
	) {
		const candidates = await this.db.workflowWait.findMany({
			where: { matchEvent, status: "active" },
			orderBy: { createdAt: "asc" },
		});

		for (const wait of candidates) {
			const predicate = wait.matchPredicate as unknown as ResolvedPredicate;
			if (!predicateMatches(predicate, eventPayload)) continue;

			const won = await this.db.workflowWait.updateMany({
				where: { id: wait.id, status: "active" },
				data: {
					status: "resumed",
					resumedAt: new Date(),
					resumedReason: "event_match",
					resumedByRunEventId: runEventId ?? null,
				},
			});
			if (won.count === 1) {
				this.wake.emit(`wait:${wait.id}`, "event_match");
				return wait;
			}
		}

		return null;
	}

	/** CAS resume by operator action. */
	async resumeManually(waitId: string): Promise<boolean> {
		const won = await this.db.workflowWait.updateMany({
			where: { id: waitId, status: "active" },
			data: {
				status: "resumed",
				resumedAt: new Date(),
				resumedReason: "manual",
			},
		});
		if (won.count === 1) this.wake.emit(`wait:${waitId}`, "manual");
		return won.count === 1;
	}

	/** CAS cancel. */
	async cancelWait(waitId: string): Promise<boolean> {
		const won = await this.db.workflowWait.updateMany({
			where: { id: waitId, status: "active" },
			data: {
				status: "cancelled",
				resumedAt: new Date(),
				resumedReason: "cancelled",
			},
		});
		if (won.count === 1) this.wake.emit(`wait:${waitId}`, "cancelled");
		return won.count === 1;
	}

	/**
	 * Timeout sweep for the cron tick: marks due active waits `timed_out`.
	 * Safe to run repeatedly (idempotent, timestamp-driven).
	 */
	async sweepTimedOutWaits(now = new Date()): Promise<number> {
		const due = await this.db.workflowWait.findMany({
			where: { status: "active", timeoutAt: { not: null, lte: now } },
			select: { id: true },
		});
		if (due.length === 0) return 0;

		const won = await this.db.workflowWait.updateMany({
			where: { id: { in: due.map((wait) => wait.id) }, status: "active" },
			data: { status: "timed_out", resumedAt: now, resumedReason: "timeout" },
		});
		for (const wait of due) this.wake.emit(`wait:${wait.id}`, "timeout");
		return won.count;
	}

	/**
	 * Step-level await: registers a wait and blocks until an event resumes it,
	 * an operator resolves it, or the absolute timeout is reached. The
	 * in-memory emitter is the fast path; the poll loop is the fallback for
	 * resumes that happen in another process. At-most-once is preserved by the
	 * CAS resume in `resumeByEvent`.
	 */
	async awaitEvent(
		registration: WaitRegistration & { timeoutMs: number },
	): Promise<AwaitEventResult> {
		const timeoutAt = new Date(Date.now() + registration.timeoutMs);
		const wait = await this.registerWait({ ...registration, timeoutAt });

		const outcome = await new Promise<WaitResumeReason>((resolve) => {
			const timer = setTimeout(
				() => resolve("timeout"),
				registration.timeoutMs,
			);
			const onWake = (reason: WaitResumeReason) => {
				clearTimeout(timer);
				this.wake.off(`wait:${wait.id}`, onWake);
				resolve(reason);
			};
			this.wake.on(`wait:${wait.id}`, onWake);

			// Fallback poll (cross-process resumes): cheap status read.
			const poll = setInterval(() => {
				void this.db.workflowWait
					.findUnique({ where: { id: wait.id } })
					.then((row) => {
						if (row && row.status !== "active") {
							clearInterval(poll);
							onWake((row.resumedReason as WaitResumeReason) ?? "timeout");
						}
					})
					.catch(() => undefined);
			}, AWAIT_POLL_MS);
			const cleanup = () => clearInterval(poll);
			this.wake.once(`wait:${wait.id}`, cleanup);
			setTimeout(cleanup, registration.timeoutMs + AWAIT_POLL_MS);
		});

		if (outcome === "timeout") {
			await this.sweepTimedOutWaits(new Date(Date.now() + 1));
		}
		const row = await this.db.workflowWait.findUnique({
			where: { id: wait.id },
		});
		return {
			waitId: wait.id,
			resumed: row?.status === "resumed",
			reason: (row?.resumedReason as WaitResumeReason | null) ?? outcome,
		};
	}

	// ----------------------------------------------------------- approvals

	async requestApproval(request: ApprovalRequest) {
		if (request.reason.trim().length === 0) {
			throw new WorkflowNonRetryableError("approval reason is required");
		}
		const id = randomUUID();
		return this.db.workflowApproval.create({
			data: {
				id,
				runId: request.runId,
				stepName: request.stepName,
				requestedByUserId: request.requestedByUserId ?? null,
				approverHint: request.approverHint ?? null,
				reason: request.reason,
				payload: (request.payload ?? {}) as object,
				status: "pending",
				timeoutAt: request.timeoutAt ?? null,
			},
		});
	}

	/**
	 * CAS resolution: only a `pending` approval can be approved/rejected. When
	 * two approvers race, exactly one wins; the loser gets `false`.
	 */
	async resolveApproval(
		approvalId: string,
		decision: GateDecision,
		resolvedByUserId: string,
		note?: string,
	): Promise<boolean> {
		if (decision !== "approved" && decision !== "rejected") {
			throw new WorkflowNonRetryableError(
				`Unknown approval decision ${decision}`,
			);
		}
		const won = await this.db.workflowApproval.updateMany({
			where: { id: approvalId, status: "pending" },
			data: {
				status: decision,
				resolvedByUserId,
				resolvedAt: new Date(),
				resolutionNote: note ?? null,
			},
		});
		if (won.count === 1) this.wake.emit(`approval:${approvalId}`, decision);
		return won.count === 1;
	}

	/**
	 * Step-level approval await: registers the request and blocks until a
	 * human resolves it or the timeout policy applies (`abort` -> timed_out,
	 * `auto_approve` -> approved by the system).
	 */
	async awaitApproval(
		request: ApprovalRequest & { timeoutMs: number },
	): Promise<AwaitApprovalResult> {
		const timeoutAt = new Date(Date.now() + request.timeoutMs);
		const approval = await this.requestApproval({ ...request, timeoutAt });

		const outcome = await new Promise<"approved" | "rejected" | "timeout">(
			(resolve) => {
				const timer = setTimeout(() => resolve("timeout"), request.timeoutMs);
				const onWake = (decision: "approved" | "rejected") => {
					clearTimeout(timer);
					this.wake.off(`approval:${approval.id}`, onWake);
					resolve(decision);
				};
				this.wake.on(`approval:${approval.id}`, onWake);
			},
		);

		let status: AwaitApprovalResult["status"];
		if (outcome === "timeout") {
			const policy = request.timeoutPolicy ?? "abort";
			const swept = await this.sweepTimedOutApprovals(
				policy,
				new Date(Date.now() + 1),
			);
			status =
				policy === "auto_approve" && swept.autoApproved === 1
					? "approved"
					: "timed_out";
			if (swept.autoApproved === 1 && policy === "auto_approve") {
				await this.db.workflowApproval.updateMany({
					where: { id: approval.id, resolutionNote: "timed_out_auto_approve" },
					data: { resolvedByUserId: "system" },
				});
			}
		} else {
			status = outcome;
		}

		const row = await this.db.workflowApproval.findUnique({
			where: { id: approval.id },
		});
		return {
			approvalId: approval.id,
			status: (row?.status as AwaitApprovalResult["status"]) ?? status,
			resolvedByUserId: row?.resolvedByUserId ?? null,
		};
	}

	async cancelApproval(approvalId: string): Promise<boolean> {
		const won = await this.db.workflowApproval.updateMany({
			where: { id: approvalId, status: "pending" },
			data: { status: "cancelled", resolvedAt: new Date() },
		});
		return won.count === 1;
	}

	/**
	 * Timeout sweep with policy: `abort` marks `timed_out`; `auto_approve`
	 * resolves as approved by the system user with a machine-readable note.
	 */
	async sweepTimedOutApprovals(
		policy: ApprovalTimeoutPolicy = "abort",
		now = new Date(),
	): Promise<{ aborted: number; autoApproved: number }> {
		const due = await this.db.workflowApproval.findMany({
			where: { status: "pending", timeoutAt: { not: null, lte: now } },
			select: { id: true },
		});

		let aborted = 0;
		let autoApproved = 0;

		for (const approval of due) {
			if (policy === "auto_approve") {
				const won = await this.db.workflowApproval.updateMany({
					where: { id: approval.id, status: "pending" },
					data: {
						status: "approved",
						resolvedByUserId: null,
						resolvedAt: now,
						resolutionNote: "timed_out_auto_approve",
					},
				});
				if (won.count === 1) autoApproved += 1;
			} else {
				const won = await this.db.workflowApproval.updateMany({
					where: { id: approval.id, status: "pending" },
					data: {
						status: "timed_out",
						resolvedAt: now,
						resolutionNote: "timed_out_abort",
					},
				});
				if (won.count === 1) aborted += 1;
			}
		}

		return { aborted, autoApproved };
	}

	// ------------------------------------------------------------ queries

	async activeWaitsForRun(runId: string) {
		return this.db.workflowWait.findMany({
			where: { runId, status: "active" },
		});
	}

	async pendingApprovals(approverHint?: string) {
		const where: Prisma.WorkflowApprovalWhereInput = { status: "pending" };
		if (approverHint) {
			where.approverHint = approverHint;
		}
		return this.db.workflowApproval.findMany({
			where,
			orderBy: { createdAt: "asc" },
		});
	}

	static isAllowedResumeReason(reason: string): reason is WaitResumeReason {
		return (RESUME_REASONS as readonly string[]).includes(reason);
	}
}
