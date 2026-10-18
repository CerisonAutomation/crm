import { describe, expect, it } from "bun:test";
import { EventDispatcherService } from "../src/events/event-dispatcher.service";
import type { ResolvedPredicate } from "../src/workflows/workflow-gates.service";
import { WorkflowGatesService } from "../src/workflows/workflow-gates.service";

type Row = Record<string, unknown> & { id: string };

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
	for (const [key, condition] of Object.entries(where)) {
		if (
			condition !== null &&
			typeof condition === "object" &&
			"in" in (condition as object)
		) {
			if (!(condition as { in: unknown[] }).in.includes(row[key])) return false;
		} else if (
			condition !== null &&
			typeof condition === "object" &&
			("lte" in (condition as object) || "not" in (condition as object))
		) {
			const spec = condition as { lte?: unknown; not?: unknown };
			if (spec.not !== undefined && spec.not !== null && row[key] === spec.not)
				return false;
			if (spec.lte !== undefined && spec.lte !== null) {
				if (
					row[key] === null ||
					(row[key] as Date).getTime() > (spec.lte as Date).getTime()
				)
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

	workflowWait = {
		create: async ({ data }: { data: Row }) => {
			const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
			this.waits.push(row);
			return row;
		},
		findMany: async ({ where }: { where: Record<string, unknown> }) =>
			this.waits.filter((row) => matchesWhere(row, where)),
		findUnique: async ({ where }: { where: { id: string } }) =>
			this.waits.find((row) => row.id === where.id) ?? null,
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
			const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
			this.approvals.push(row);
			return row;
		},
		findMany: async ({ where }: { where: Record<string, unknown> }) =>
			this.approvals.filter((row) => matchesWhere(row, where)),
		findUnique: async ({ where }: { where: { id: string } }) =>
			this.approvals.find((row) => row.id === where.id) ?? null,
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

function gatesPair(): { gates: WorkflowGatesService; db: InMemoryGatesDb } {
	const db = new InMemoryGatesDb();
	return { gates: new WorkflowGatesService(db as never), db };
}

describe("EventDispatcherService (unified fan-out)", () => {
	it("delivers one event to routines, webhooks and matching gate waits", async () => {
		const calls: string[] = [];
		const { gates } = gatesPair();
		await gates.registerWait({
			runId: "run-1",
			stepName: "await-message",
			matchEvent: "channel.message.received",
			matchPredicate: { senderHandle: "user-9" },
			timeoutAt: null,
		});

		const dispatcher = new EventDispatcherService(
			{
				dispatchEvent: async () => {
					calls.push("routines");
					return ["routine-1"];
				},
			} as never,
			{
				dispatch: async () => {
					calls.push("webhooks");
					return ["delivery-1"];
				},
			} as never,
			gates,
		);

		const report = await dispatcher.dispatch({
			event: "channel.message.received",
			ownerUserId: "user-1",
			entityId: "wamid.abc",
			at: new Date(),
			payload: { senderHandle: "user-9", body: "Hello" },
		});

		expect(calls.sort()).toEqual(["routines", "webhooks"]);
		expect(report.routinesQueued).toEqual(["routine-1"]);
		expect(report.webhookDeliveries).toEqual(["delivery-1"]);
		expect(report.waitsResumed).toBe(1);
		expect(report.failures).toEqual([]);
	});

	it("isolates a failing consumer without blocking the others", async () => {
		const { gates } = gatesPair();
		const dispatcher = new EventDispatcherService(
			{
				dispatchEvent: async () => {
					throw new Error("routines down");
				},
			} as never,
			{
				dispatch: async () => ["delivery-1"],
			} as never,
			gates,
		);

		const report = await dispatcher.dispatch({
			event: "booking.created",
			ownerUserId: "user-1",
			entityId: "booking-1",
			at: new Date(),
			payload: {},
		});

		expect(report.webhookDeliveries).toEqual(["delivery-1"]);
		expect(report.failures.length).toBe(1);
		expect(report.failures[0]).toContain("routines");
	});

	it("does not resume waits whose frozen predicate misses", async () => {
		const { gates } = gatesPair();
		await gates.registerWait({
			runId: "run-2",
			stepName: "await-won",
			matchEvent: "deal.updated",
			matchPredicate: { dealId: "d1" },
			timeoutAt: null,
		});
		const dispatcher = new EventDispatcherService(
			{ dispatchEvent: async () => [] } as never,
			{ dispatch: async () => [] } as never,
			gates,
		);
		const report = await dispatcher.dispatch({
			event: "deal.updated",
			ownerUserId: "user-1",
			entityId: "d2",
			at: new Date(),
			payload: { dealId: "d2" },
		});
		expect(report.waitsResumed).toBe(0);
	});
});

describe("step-level gates (awaitEvent / awaitApproval)", () => {
	it("awaitEvent resolves fast when resumeByEvent lands (emitter path)", async () => {
		const { gates } = gatesPair();
		const pending = gates.awaitEvent({
			runId: "run-3",
			stepName: "await-ping",
			matchEvent: "ping",
			matchPredicate: {},
			timeoutMs: 2000,
		});

		// Let the wait register before dispatching the event.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const resumed = await gates.resumeByEvent("ping", {});
		expect(resumed).not.toBeNull();

		const outcome = await pending;
		expect(outcome.resumed).toBe(true);
		expect(outcome.reason).toBe("event_match");
	});

	it("awaitEvent times out and marks the wait timed_out", async () => {
		const { gates, db } = gatesPair();
		const outcome = await gates.awaitEvent({
			runId: "run-4",
			stepName: "await-never",
			matchEvent: "never",
			matchPredicate: {},
			timeoutMs: 60,
		});
		expect(outcome.resumed).toBe(false);
		expect(outcome.reason).toBe("timeout");
		expect(db.waits[0]?.status).toBe("timed_out");
	});

	it("awaitApproval resolves on CAS approve exactly once", async () => {
		const { gates } = gatesPair();
		const pending = gates.awaitApproval({
			runId: "run-5",
			stepName: "gate",
			reason: "Ship it",
			timeoutMs: 2000,
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		const resolved = await gates.resolveApproval(
			(await gates.pendingApprovals())[0]?.id ?? "",
			"approved",
			"user-boss",
		);
		expect(resolved).toBe(true);

		const outcome = await pending;
		expect(outcome.status).toBe("approved");
		expect(outcome.resolvedByUserId).toBe("user-boss");
	});

	it("awaitApproval abort policy resolves timed_out at deadline", async () => {
		const { gates } = gatesPair();
		const outcome = await gates.awaitApproval({
			runId: "run-6",
			stepName: "gate",
			reason: "No one is watching",
			timeoutMs: 60,
			timeoutPolicy: "abort",
		});
		expect(outcome.status).toBe("timed_out");
	});
});

describe("predicate freeze at registration", () => {
	it("keeps literal values frozen even if the payload later differs", async () => {
		const predicate: ResolvedPredicate = {
			contactId: "c-frozen",
			stage: "won",
		};
		const { gates } = gatesPair();
		await gates.registerWait({
			runId: "run-7",
			stepName: "frozen",
			matchEvent: "deal.updated",
			matchPredicate: predicate,
			timeoutAt: null,
		});
		expect(
			await gates.resumeByEvent("deal.updated", {
				contactId: "c-frozen",
				stage: "lost",
			}),
		).toBeNull();
		expect(
			await gates.resumeByEvent("deal.updated", {
				contactId: "c-frozen",
				stage: "won",
			}),
		).not.toBeNull();
	});
});
