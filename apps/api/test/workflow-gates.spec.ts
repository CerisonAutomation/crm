import { describe, expect, it } from "bun:test";
import {
	predicateMatches,
	WorkflowGatesService,
} from "../src/workflows/workflow-gates.service";

type Row = Record<string, unknown> & { id: string };

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
	for (const [key, condition] of Object.entries(where)) {
		if (
			condition !== null &&
			typeof condition === "object" &&
			"in" in (condition as object)
		) {
			const list = (condition as { in: unknown[] }).in;
			if (!list.includes(row[key])) return false;
		} else if (
			condition !== null &&
			typeof condition === "object" &&
			("lte" in (condition as object) || "not" in (condition as object))
		) {
			const spec = condition as { lte?: unknown; not?: unknown };
			if (spec.not !== undefined && spec.not !== null && row[key] === spec.not)
				return false;
			if (spec.lte !== undefined && spec.lte !== null) {
				const rowTime = (row[key] as Date).getTime();
				if (row[key] === null || rowTime > (spec.lte as Date).getTime())
					return false;
			}
		} else if (row[key] !== condition) {
			return false;
		}
	}
	return true;
}

class InMemoryGatesDb {
	waits: Row[] = [];
	approvals: Row[] = [];
	private seq = 0;

	workflowWait = {
		create: async ({ data }: { data: Row }) => {
			const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
			this.waits.push(row);
			return row;
		},
		findMany: async ({ where }: { where: Record<string, unknown> }) =>
			this.waits.filter((row) => matchesWhere(row, where)),
		updateMany: async ({
			where,
			data,
		}: {
			where: Record<string, unknown>;
			data: Record<string, unknown>;
		}) => {
			const hits = this.waits.filter((row) => matchesWhere(row, where));
			for (const row of hits) Object.assign(row, data);
			return { count: hits.length };
		},
	};

	workflowApproval = {
		create: async ({ data }: { data: Row }) => {
			const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
			this.approvals.push(row);
			return row;
		},
		findMany: async ({ where }: { where: Record<string, unknown> }) =>
			this.approvals.filter((row) => matchesWhere(row, where)),
		updateMany: async ({
			where,
			data,
		}: {
			where: Record<string, unknown>;
			data: Record<string, unknown>;
		}) => {
			const hits = this.approvals.filter((row) => matchesWhere(row, where));
			for (const row of hits) Object.assign(row, data);
			return { count: hits.length };
		},
	};
}

function service(): { gates: WorkflowGatesService; db: InMemoryGatesDb } {
	const db = new InMemoryGatesDb();
	return { gates: new WorkflowGatesService(db as never), db };
}

describe("predicateMatches (frozen predicates)", () => {
	it("matches when every frozen key equals the event value", () => {
		expect(
			predicateMatches(
				{ contactId: "c1", stage: "won" },
				{ contactId: "c1", stage: "won", extra: 1 },
			),
		).toBe(true);
		expect(predicateMatches({ contactId: "c1" }, { contactId: "c2" })).toBe(
			false,
		);
		expect(predicateMatches({}, { anything: true })).toBe(true);
	});
});

describe("workflow waits", () => {
	it("resumes exactly one wait per event (CAS)", async () => {
		const { gates, db } = service();
		await gates.registerWait({
			runId: "run-1",
			stepName: "await-won",
			matchEvent: "deal.updated",
			matchPredicate: { dealId: "d1" },
			timeoutAt: null,
		});

		const first = await gates.resumeByEvent("deal.updated", { dealId: "d1" });
		expect(first).not.toBeNull();
		const second = await gates.resumeByEvent("deal.updated", { dealId: "d1" });
		expect(second).toBeNull();
		expect(db.waits[0]?.resumedReason).toBe("event_match");
	});

	it("ignores events whose payload does not satisfy the frozen predicate", async () => {
		const { gates } = service();
		await gates.registerWait({
			runId: "run-2",
			stepName: "await-won",
			matchEvent: "deal.updated",
			matchPredicate: { dealId: "d1" },
			timeoutAt: null,
		});
		const resumed = await gates.resumeByEvent("deal.updated", {
			dealId: "other",
		});
		expect(resumed).toBeNull();
	});

	it("sweeps timeouts idempotently", async () => {
		const { gates, db } = service();
		await gates.registerWait({
			runId: "run-3",
			stepName: "slow",
			matchEvent: "ping",
			matchPredicate: {},
			timeoutAt: new Date(Date.now() - 1000),
		});
		const first = await gates.sweepTimedOutWaits();
		expect(first).toBe(1);
		const second = await gates.sweepTimedOutWaits();
		expect(second).toBe(0);
		expect(db.waits[0]?.status).toBe("timed_out");
		expect(db.waits[0]?.resumedReason).toBe("timeout");
	});

	it("cancel is CAS too", async () => {
		const { gates } = service();
		const wait = await gates.registerWait({
			runId: "run-4",
			stepName: "x",
			matchEvent: "ping",
			matchPredicate: {},
			timeoutAt: null,
		});
		expect(await gates.cancelWait(wait.id)).toBe(true);
		expect(await gates.cancelWait(wait.id)).toBe(false);
	});
});

describe("workflow approvals", () => {
	it("resolves once even under racing approvers", async () => {
		const { gates, db } = service();
		const approval = await gates.requestApproval({
			runId: "run-5",
			stepName: "refund",
			reason: "Refund 100 EUR to customer",
			approverHint: "finance",
		});

		expect(await gates.resolveApproval(approval.id, "approved", "user-1")).toBe(
			true,
		);
		expect(await gates.resolveApproval(approval.id, "rejected", "user-2")).toBe(
			false,
		);
		expect(db.approvals[0]?.status).toBe("approved");
		expect(db.approvals[0]?.resolvedByUserId).toBe("user-1");
	});

	it("applies abort and auto-approve timeout policies", async () => {
		const { gates, db } = service();
		const abort = await gates.requestApproval({
			runId: "run-6",
			stepName: "publish",
			reason: "Publish campaign",
			timeoutAt: new Date(Date.now() - 500),
		});
		const sweepAborted = await gates.sweepTimedOutApprovals("abort");
		expect(sweepAborted).toEqual({ aborted: 1, autoApproved: 0 });
		expect(
			db.approvals.find((row) => row.id === abort.id)?.resolutionNote,
		).toBe("timed_out_abort");

		const auto = await gates.requestApproval({
			runId: "run-7",
			stepName: "publish",
			reason: "Publish campaign",
			timeoutAt: new Date(Date.now() - 500),
		});
		const sweepAuto = await gates.sweepTimedOutApprovals("auto_approve");
		expect(sweepAuto).toEqual({ aborted: 0, autoApproved: 1 });
		expect(db.approvals.find((row) => row.id === auto.id)?.status).toBe(
			"approved",
		);
		expect(db.approvals.find((row) => row.id === auto.id)?.resolutionNote).toBe(
			"timed_out_auto_approve",
		);
	});

	it("keeps rows after cancel (forensic retention)", async () => {
		const { gates, db } = service();
		const approval = await gates.requestApproval({
			runId: "run-8",
			stepName: "wipe",
			reason: "Delete all records",
		});
		expect(await gates.cancelApproval(approval.id)).toBe(true);
		expect(db.approvals).toHaveLength(1);
		expect(db.approvals[0]?.status).toBe("cancelled");
	});
});
