import { describe, expect, it } from "bun:test";
import {
	AgentGovernanceService,
	buildDerivedEvalSummary,
} from "../src/agent-governance/agent-governance.service";

type Row = Record<string, unknown> & { id: string };

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
	for (const [key, condition] of Object.entries(where)) {
		if (condition !== null && typeof condition === "object" && "lt" in (condition as object)) {
			if ((row[key] as Date).getTime() >= ((condition as { lt: Date }).lt).getTime()) return false;
		} else if (row[key] !== condition) {
			return false;
		}
	}
	return true;
}

class InMemoryGovernanceDb {
	receipts: Row[] = [];
	drafts: Row[] = [];
	reflections: Row[] = [];
	taste: Row[] = [];
	evals: Row[] = [];
	private seq = 0;

	private store(rows: Row[]) {
		return {
			create: async ({ data }: { data: Row }) => {
				const row = { createdAt: new Date(), updatedAt: new Date(), ...data, id: data.id ?? `row-${++this.seq}` };
				rows.push(row);
				return row;
			},
			findMany: async ({ where = {} }: { where?: Record<string, unknown> }) =>
				rows.filter((row) => matchesWhere(row, where)),
			updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
				const hits = rows.filter((row) => matchesWhere(row, where));
				for (const row of hits) Object.assign(row, data);
				return { count: hits.length };
			},
		};
	}

	agentRunReceipt = this.store(this.receipts);
	agentActionDraft = this.store(this.drafts);
	agentReflectionEvent = this.store(this.reflections);
	agentTasteSession = this.store(this.taste);
	evalRun = this.store(this.evals);
}

function service(): { governance: AgentGovernanceService; db: InMemoryGovernanceDb } {
	const db = new InMemoryGovernanceDb();
	return { governance: new AgentGovernanceService(db as never), db };
}

describe("buildDerivedEvalSummary (derived-text-only guarantee)", () => {
	it("keeps only titles, pass/fail and failed check names", () => {
		const summary = buildDerivedEvalSummary([
			{ title: "greets politely", passed: true },
			{ title: "handles refund", passed: false, failedChecks: ["tone", "policy"] },
		]);
		expect(summary.passed).toBe(1);
		expect(summary.failed).toBe(1);
		expect(summary.scenarios[1]?.failedChecks).toEqual(["tone", "policy"]);
		expect(JSON.stringify(summary)).not.toContain("transcript");
	});

	it("caps scenario count and string lengths", () => {
		const scenarios = Array.from({ length: 250 }, (_, index) => ({
			title: "x".repeat(500),
			passed: index % 2 === 0,
		}));
		const summary = buildDerivedEvalSummary(scenarios);
		expect(summary.scenarios.length).toBe(200);
		expect(summary.scenarios[0]?.title.length).toBe(200);
	});
});

describe("action drafts (CAS state machine)", () => {
	it("resolves once even under racing reviewers", async () => {
		const { governance } = service();
		const draft = await governance.createDraft("user-1", {
			agentKind: "closer",
			actionKind: "send_email",
			reason: "Follow up with lead",
		});
		expect(await governance.resolveDraft(draft.id, "approved", "user-a")).toBe(true);
		expect(await governance.resolveDraft(draft.id, "rejected", "user-b")).toBe(false);
	});

	it("executes only approved drafts exactly once", async () => {
		const { governance, db } = service();
		const draft = await governance.createDraft("user-1", {
			agentKind: "closer",
			actionKind: "update_deal",
			reason: "Move deal to won",
		});
		expect(await governance.markExecuted(draft.id)).toBe(false);
		await governance.resolveDraft(draft.id, "approved", "user-a");
		expect(await governance.markExecuted(draft.id)).toBe(true);
		expect(await governance.markExecuted(draft.id)).toBe(false);
		expect(db.drafts[0]?.status).toBe("executed");
	});

	it("expires stale pending drafts (sweep)", async () => {
		const { governance, db } = service();
		await governance.createDraft("user-1", {
			agentKind: "closer",
			actionKind: "send_email",
			reason: "old",
		});
		db.drafts[0]!.createdAt = new Date(Date.now() - 86_400_000);
		const expired = await governance.expireStaleDrafts(new Date());
		expect(expired).toBe(1);
		expect(db.drafts[0]?.status).toBe("expired");
	});
});

describe("receipts, reflections and taste", () => {
	it("records receipts with allowlisted status", async () => {
		const { governance } = service();
		const receipt = await governance.recordReceipt("user-1", {
			agentKind: "receptionist",
			externalRunId: "run-1",
			status: "succeeded",
			summary: "Booked a demo",
			startedAt: new Date(),
		});
		expect(receipt.agentKind).toBe("receptionist");
		expect(
			governance.recordReceipt("user-1", {
				agentKind: "receptionist",
				externalRunId: "run-2",
				status: "exploded" as never,
				summary: "x",
				startedAt: new Date(),
			}),
		).rejects.toThrow();
	});

	it("validates reflection kinds and taste confidence", async () => {
		const { governance } = service();
		await governance.recordReflection("user-1", { kind: "self_critique", content: "tone was off" });
		expect(
			governance.recordReflection("user-1", { kind: "whatever", content: "x" }),
		).rejects.toThrow();
		expect(
			governance.recordTaste("user-1", { topic: "pricing", preferences: {}, confidence: 2 }),
		).rejects.toThrow();
		const taste = await governance.recordTaste("user-1", {
			topic: "pricing",
			preferences: { currency: "EUR" },
			confidence: 0.8,
		});
		expect(taste.confidence).toBe(0.8);
	});

	it("records eval runs and derives pass/fail", async () => {
		const { governance, db } = service();
		const run = await governance.recordEvalRun("user-1", {
			kind: "publish_gate",
			targetKind: "agent",
			targetId: "agent-1",
			scenarios: [{ title: "a", passed: true }],
		});
		expect(run.passed).toBe(true);
		const mixed = await governance.recordEvalRun("user-1", {
			kind: "baseline",
			targetKind: "agent",
			targetId: "agent-1",
			scenarios: [{ title: "a", passed: true }, { title: "b", passed: false }],
		});
		expect(mixed.passed).toBeNull();
		expect(db.evals.length).toBe(2);
	});
});
