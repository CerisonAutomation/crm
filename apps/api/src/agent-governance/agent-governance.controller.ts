/**
 * Agent governance routes: run receipts, action drafts (CAS state machine),
 * reflection events, taste sessions and durable eval runs.
 */

import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { auth } from "@crm/auth";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { EventDispatcherService } from "../events/event-dispatcher.service";
import {
	AgentGovernanceService,
	type DraftInput,
	type EvalRunInput,
	type ReceiptInput,
} from "./agent-governance.service";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Agent Governance")
@Controller("api/agent-governance")
export class AgentGovernanceController {
	constructor(
		private readonly governance: AgentGovernanceService,
		private readonly events: EventDispatcherService,
	) {}

	@Post("receipts")
	@ApiOperation({ summary: "Record an agent run receipt" })
	async recordReceipt(@Session() session: CrmSession, @Body() body: ReceiptInput) {
		return { receipt: await this.governance.recordReceipt(session.user.id, body) };
	}

	@Get("receipts")
	@ApiOperation({ summary: "List run receipts" })
	async receipts(@Session() session: CrmSession, @Query("agentKind") agentKind?: string) {
		return { receipts: await this.governance.listReceipts(session.user.id, agentKind) };
	}

	@Post("drafts")
	@ApiOperation({ summary: "Propose an agent action draft for review" })
	async createDraft(@Session() session: CrmSession, @Body() body: DraftInput) {
		const draft = await this.governance.createDraft(session.user.id, body);
		await this.events.dispatch({
			event: "agent.draft.created",
			ownerUserId: session.user.id,
			entityId: draft.id,
			at: new Date(),
			payload: {
				draftId: draft.id,
				agentKind: draft.agentKind,
				actionKind: draft.actionKind,
				reason: draft.reason,
			},
		});
		return { draft };
	}

	@Get("drafts/pending")
	@ApiOperation({ summary: "Pending action drafts" })
	async pendingDrafts(@Session() session: CrmSession) {
		return { drafts: await this.governance.pendingDrafts(session.user.id) };
	}

	@Post("drafts/:id/resolve")
	@ApiOperation({ summary: "Approve or reject a draft (compare-and-swap)" })
	async resolveDraft(
		@Session() session: CrmSession,
		@Param("id") id: string,
		@Body() body: { decision: "approved" | "rejected"; note?: string },
	) {
		const resolved = await this.governance.resolveDraft(id, body.decision, session.user.id, body.note);
		if (resolved) {
			await this.events.dispatch({
				event: "agent.draft.resolved",
				ownerUserId: session.user.id,
				entityId: id,
				at: new Date(),
				payload: { draftId: id, decision: body.decision, note: body.note ?? null },
			});
		}
		return { resolved };
	}

	@Post("drafts/:id/execute")
	@ApiOperation({ summary: "Mark an approved draft executed (compare-and-swap)" })
	async executeDraft(@Param("id") id: string) {
		return { executed: await this.governance.markExecuted(id) };
	}

	@Post("reflections")
	@ApiOperation({ summary: "Record an agent reflection event" })
	async reflection(
		@Session() session: CrmSession,
		@Body() body: { runReceiptId?: string; kind: string; content: string },
	) {
		return { reflection: await this.governance.recordReflection(session.user.id, body) };
	}

	@Get("reflections")
	@ApiOperation({ summary: "List reflection events" })
	async reflections(@Session() session: CrmSession, @Query("kind") kind?: string) {
		return { reflections: await this.governance.listReflections(session.user.id, kind) };
	}

	@Post("taste")
	@ApiOperation({ summary: "Record a taste (preference) session" })
	async taste(
		@Session() session: CrmSession,
		@Body() body: { topic: string; preferences: Record<string, unknown>; confidence?: number },
	) {
		return { taste: await this.governance.recordTaste(session.user.id, body) };
	}

	@Get("taste/:topic")
	@ApiOperation({ summary: "Taste sessions for a topic" })
	async tasteForTopic(@Session() session: CrmSession, @Param("topic") topic: string) {
		return { sessions: await this.governance.tasteForTopic(session.user.id, topic) };
	}

	@Post("eval-runs")
	@ApiOperation({ summary: "Record a durable eval run (derived summaries only)" })
	async evalRun(@Session() session: CrmSession, @Body() body: EvalRunInput) {
		return { evalRun: await this.governance.recordEvalRun(session.user.id, body) };
	}

	@Get("eval-runs")
	@ApiOperation({ summary: "Eval runs for a target" })
	async evalRuns(
		@Session() session: CrmSession,
		@Query("targetKind") targetKind: string,
		@Query("targetId") targetId: string,
	) {
		if (!targetKind || !targetId) throw new ForbiddenException("targetKind and targetId are required");
		return {
			evalRuns: await this.governance.evalRunsForTarget(session.user.id, targetKind, targetId),
		};
	}
}
