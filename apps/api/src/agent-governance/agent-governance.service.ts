/**
 * Agent governance ledger (pattern harvested from SeldonFrame U5:
 * agent-run-receipts, agent-action-drafts, agent-reflection-events,
 * agent-taste-sessions, eval-runs).
 *
 * Trust story: every agent run leaves a receipt; every proposed action is a
 * reviewable draft with a CAS state machine; reflections and taste sessions
 * capture judgment; eval runs are durable records whose summaries carry
 * DERIVED text only — never raw customer transcripts (SeldonFrame
 * eval-runs design constraint preserved in `buildDerivedEvalSummary`).
 */

import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

export type ReceiptInput = {
	agentKind: string;
	externalRunId: string;
	status: "succeeded" | "failed" | "cancelled";
	summary: string;
	metrics?: Record<string, unknown>;
	startedAt: Date;
	finishedAt?: Date | null;
};

export type DraftInput = {
	agentKind: string;
	actionKind: string;
	reason: string;
	payload?: Record<string, unknown>;
};

export type DraftDecision = "approved" | "rejected";

export type EvalRunInput = {
	kind: "manual" | "baseline" | "candidate" | "publish_gate";
	targetKind: "agent" | "marketplace_template";
	targetId: string;
	scenarios: Array<{
		title: string;
		passed: boolean;
		failedChecks?: string[];
	}>;
	rawTranscript?: string;
};

const REFLECTION_KINDS = new Set([
	"self_critique",
	"improvement",
	"taste",
	"correction",
]);
const RECEIPT_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const EVAL_KINDS = new Set(["manual", "baseline", "candidate", "publish_gate"]);
const EVAL_TARGET_KINDS = new Set(["agent", "marketplace_template"]);
const MAX_SUMMARY_LENGTH = 2000;

/**
 * Derived-text-only eval summary: scenario titles, pass/fail and failed check
 * names survive; ANY other field (transcripts, payloads) is dropped at the
 * boundary. Pure so the guarantee is testable.
 */
export function buildDerivedEvalSummary(scenarios: EvalRunInput["scenarios"]): {
	passed: number;
	failed: number;
	scenarios: Array<{ title: string; passed: boolean; failedChecks: string[] }>;
} {
	const cleaned = scenarios.slice(0, 200).map((scenario) => ({
		title: String(scenario.title).slice(0, 200),
		passed: Boolean(scenario.passed),
		failedChecks: (scenario.failedChecks ?? [])
			.slice(0, 50)
			.map((check) => String(check).slice(0, 100)),
	}));
	return {
		passed: cleaned.filter((scenario) => scenario.passed).length,
		failed: cleaned.filter((scenario) => !scenario.passed).length,
		scenarios: cleaned,
	};
}

@Injectable()
export class AgentGovernanceService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	// ------------------------------------------------------------- receipts

	async recordReceipt(ownerUserId: string, input: ReceiptInput) {
		if (!RECEIPT_STATUSES.has(input.status)) {
			throw new WorkflowNonRetryableError(
				`Unknown receipt status ${input.status}`,
			);
		}
		return this.db.agentRunReceipt.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				agentKind: input.agentKind,
				externalRunId: input.externalRunId,
				status: input.status,
				summary: input.summary.slice(0, MAX_SUMMARY_LENGTH),
				metrics: (input.metrics ?? {}) as Prisma.InputJsonValue,
				startedAt: input.startedAt,
				finishedAt: input.finishedAt ?? null,
			},
		});
	}

	async listReceipts(ownerUserId: string, agentKind?: string, limit = 50) {
		return this.db.agentRunReceipt.findMany({
			where: { ownerUserId, ...(agentKind ? { agentKind } : {}) },
			orderBy: { createdAt: "desc" },
			take: limit,
		});
	}

	// --------------------------------------------------------------- drafts

	async createDraft(ownerUserId: string, input: DraftInput) {
		if (input.reason.trim().length === 0) {
			throw new WorkflowNonRetryableError("draft reason is required");
		}
		return this.db.agentActionDraft.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				agentKind: input.agentKind,
				actionKind: input.actionKind,
				reason: input.reason,
				payload: (input.payload ?? {}) as Prisma.InputJsonValue,
				status: "pending",
			},
		});
	}

	/** CAS resolution: only `pending` drafts resolve; racing approvers settle once. */
	async resolveDraft(
		draftId: string,
		decision: DraftDecision,
		resolvedByUserId: string,
		note?: string,
	): Promise<boolean> {
		if (decision !== "approved" && decision !== "rejected") {
			throw new WorkflowNonRetryableError(`Unknown draft decision ${decision}`);
		}
		const won = await this.db.agentActionDraft.updateMany({
			where: { id: draftId, status: "pending" },
			data: {
				status: decision,
				resolvedByUserId,
				resolvedAt: new Date(),
				resolutionNote: note ?? null,
			},
		});
		return won.count === 1;
	}

	/** CAS execution guard: only approved drafts execute, and only once. */
	async markExecuted(draftId: string): Promise<boolean> {
		const won = await this.db.agentActionDraft.updateMany({
			where: { id: draftId, status: "approved" },
			data: { status: "executed", executedAt: new Date() },
		});
		return won.count === 1;
	}

	/** CAS expiry sweep for stale pending drafts. */
	async expireStaleDrafts(olderThan: Date): Promise<number> {
		const won = await this.db.agentActionDraft.updateMany({
			where: { status: "pending", createdAt: { lt: olderThan } },
			data: {
				status: "expired",
				resolvedAt: new Date(),
				resolutionNote: "expired_sweep",
			},
		});
		return won.count;
	}

	async pendingDrafts(ownerUserId: string) {
		return this.db.agentActionDraft.findMany({
			where: { ownerUserId, status: "pending" },
			orderBy: { createdAt: "asc" },
		});
	}

	// ---------------------------------------------------------- reflections

	async recordReflection(
		ownerUserId: string,
		input: {
			runReceiptId?: string | null;
			kind: string;
			content: string;
		},
	) {
		if (!REFLECTION_KINDS.has(input.kind)) {
			throw new WorkflowNonRetryableError(
				`Unknown reflection kind ${input.kind}`,
			);
		}
		return this.db.agentReflectionEvent.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				runReceiptId: input.runReceiptId ?? null,
				kind: input.kind,
				content: input.content.slice(0, 4000),
			},
		});
	}

	async listReflections(ownerUserId: string, kind?: string) {
		return this.db.agentReflectionEvent.findMany({
			where: { ownerUserId, ...(kind ? { kind } : {}) },
			orderBy: { createdAt: "desc" },
		});
	}

	// -------------------------------------------------------- taste sessions

	async recordTaste(
		ownerUserId: string,
		input: {
			topic: string;
			preferences: Record<string, unknown>;
			confidence?: number | null;
		},
	) {
		if (input.confidence !== undefined && input.confidence !== null) {
			if (input.confidence < 0 || input.confidence > 1) {
				throw new WorkflowNonRetryableError(
					"confidence must be between 0 and 1",
				);
			}
		}
		return this.db.agentTasteSession.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				topic: input.topic,
				preferences: input.preferences as Prisma.InputJsonValue,
				confidence: input.confidence ?? null,
			},
		});
	}

	async tasteForTopic(ownerUserId: string, topic: string) {
		return this.db.agentTasteSession.findMany({
			where: { ownerUserId, topic },
			orderBy: { createdAt: "desc" },
		});
	}

	// ------------------------------------------------------------- eval runs

	async recordEvalRun(ownerUserId: string, input: EvalRunInput) {
		if (!EVAL_KINDS.has(input.kind)) {
			throw new WorkflowNonRetryableError(`Unknown eval kind ${input.kind}`);
		}
		if (!EVAL_TARGET_KINDS.has(input.targetKind)) {
			throw new WorkflowNonRetryableError(
				`Unknown eval target kind ${input.targetKind}`,
			);
		}
		const summary = buildDerivedEvalSummary(input.scenarios);
		const passed =
			summary.failed === 0 ? true : summary.passed === 0 ? false : null;
		return this.db.evalRun.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				kind: input.kind,
				targetKind: input.targetKind,
				targetId: input.targetId,
				summary: summary as unknown as Prisma.InputJsonValue,
				passed,
			},
		});
	}

	async evalRunsForTarget(
		ownerUserId: string,
		targetKind: string,
		targetId: string,
	) {
		return this.db.evalRun.findMany({
			where: { ownerUserId, targetKind, targetId },
			orderBy: { createdAt: "desc" },
		});
	}
}
