import { describe, expect, it } from "bun:test";
import {
	isRedelivery,
	messageFingerprint,
} from "../src/channels/message-cleaner";
import { EventDispatcherService } from "../src/events/event-dispatcher.service";
import {
	type ResumableWorkflowDefinition,
	ResumableWorkflowService,
} from "../src/workflows/resumable-workflow.service";
import { WorkflowGatesService } from "../src/workflows/workflow-gates.service";
import { WorkflowLedgerService } from "../src/workflows/workflow-ledger.service";

type Row = Record<string, unknown> & { id: string };

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
	for (const [key, condition] of Object.entries(where)) {
		if (
			condition !== null &&
			typeof condition === "object" &&
			!Array.isArray(condition)
		) {
			const spec = condition as {
				in?: unknown[];
				lte?: unknown;
				gte?: unknown;
				not?: unknown;
			};
			if (spec.in && !spec.in.includes(row[key])) return false;
			if (spec.not !== undefined && row[key] === spec.not) return false;
			if (
				spec.lte !== undefined &&
				(row[key] as Date).getTime() > (spec.lte as Date).getTime()
			)
				return false;
			if (
				spec.gte !== undefined &&
				(row[key] as Date).getTime() < (spec.gte as Date).getTime()
			)
				return false;
			if (
				spec.in === undefined &&
				spec.lte === undefined &&
				spec.gte === undefined &&
				spec.not === undefined
			) {
				// nested object equality (e.g. compound unique keys)
				for (const [nestedKey, nestedValue] of Object.entries(spec)) {
					if (row[key]?.[nestedKey as never] !== nestedValue) return false;
				}
			}
		} else if (row[key] !== condition) {
			return false;
		}
	}
	return true;
}

class InMemoryWorkflowDb {
	runs: Row[] = [];
	events: Row[] = [];
	waits: Row[] = [];
	approvals: Row[] = [];
	private seq = 0;

	workflowRun = {
		create: async ({ data }: { data: Row }) => {
			const row = {
				createdAt: new Date(),
				updatedAt: new Date(),
				attemptCount: 0,
				maxAttempts: 3,
				...data,
				id: data.id ?? `run-${++this.seq}`,
			};
			this.runs.push(row);
			return row;
		},
		findUnique: async ({ where }: { where: { id: string } }) =>
			this.runs.find((row) => row.id === where.id) ?? null,
		update: async ({
			where,
			data,
		}: {
			where: { id: string };
			data: Record<string, unknown>;
		}) => {
			const row = this.runs.find((entry) => entry.id === where.id);
			if (!row) throw new Error("unknown run");
			Object.assign(row, data);
			return row;
		},
	};

	workflowEventLog = {
		create: async ({ data }: { data: Row }) => {
			const row = {
				createdAt: new Date(),
				...data,
				id: data.id ?? `evt-${++this.seq}`,
			};
			this.events.push(row);
			return row;
		},
		findFirst: async ({ where }: { where: Record<string, unknown> }) =>
			[...this.events].reverse().find((row) => matchesWhere(row, where)) ??
			null,
		findMany: async ({ where }: { where: Record<string, unknown> }) =>
			this.events.filter((row) => matchesWhere(row, where)),
	};

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

function stack(): {
	db: InMemoryWorkflowDb;
	gates: WorkflowGatesService;
	ledger: WorkflowLedgerService;
	resumable: ResumableWorkflowService;
	dispatcher: EventDispatcherService;
} {
	const db = new InMemoryWorkflowDb();
	const gates = new WorkflowGatesService(db as never);
	const ledger = new WorkflowLedgerService(db as never);
	const resumable = new ResumableWorkflowService(db as never, gates, ledger);
	const dispatcher = new EventDispatcherService(
		{ dispatchEvent: async () => [] } as never,
		{ dispatch: async () => [] } as never,
		gates,
		resumable,
	);
	return { db, gates, ledger, resumable, dispatcher };
}

type CountState = { count: number };

const counter: ResumableWorkflowDefinition<CountState> = {
	name: "counter",
	start: async (input) => ({
		kind: "wait",
		state: { count: (input as { n: number }).n },
		matchEvent: "counter.tick",
		matchPredicate: {},
		timeoutMs: 5000,
	}),
	resume: async (state, trigger) => {
		const next = state.count + 1;
		if (next >= 3)
			return {
				kind: "done",
				result: { final: next, saw: trigger.payload.note ?? null },
			};
		return {
			kind: "wait",
			state: { count: next },
			matchEvent: "counter.tick",
			matchPredicate: {},
			timeoutMs: 5000,
		};
	},
};

describe("resumable workflows (durable pause/resume)", () => {
	it("yields at a wait and resumes through the dispatcher until done", async () => {
		const { resumable, dispatcher } = stack();
		resumable.register(counter);

		const first = await resumable.runToYield("counter", { n: 0 });
		expect(first.status).toBe("waiting");
		if (first.status !== "waiting") throw new Error("unreachable");

		const second = await dispatcher.dispatch({
			event: "counter.tick",
			ownerUserId: "user-1",
			entityId: "e1",
			at: new Date(),
			payload: { note: "first" },
		});
		expect(second.resumableAdvanced).toBe(0); // still waiting (count=1 < 3)

		await dispatcher.dispatch({
			event: "counter.tick",
			ownerUserId: "user-1",
			entityId: "e2",
			at: new Date(),
			payload: { note: "second" },
		});
		const third = await dispatcher.dispatch({
			event: "counter.tick",
			ownerUserId: "user-1",
			entityId: "e3",
			at: new Date(),
			payload: { note: "final-tick" },
		});
		expect(third.resumableAdvanced).toBe(1);

		const yields = await resumable.resumeMatching("counter.tick", {});
		expect(yields).toEqual([]); // nothing left waiting
	});

	it("yields at an approval gate and completes on explicit resume", async () => {
		const { resumable, gates } = stack();
		const approveFlow: ResumableWorkflowDefinition<Record<string, never>> = {
			name: "approve-flow",
			start: async () => ({
				kind: "approval",
				state: {},
				reason: "publish campaign",
				timeoutMs: 5000,
			}),
			resume: async () => ({ kind: "done", result: "published" }),
		};
		resumable.register(approveFlow);

		const waiting = await resumable.runToYield("approve-flow", {});
		expect(waiting.status).toBe("waiting");
		if (waiting.status !== "waiting") throw new Error("unreachable");

		const pending = await gates.pendingApprovals();
		expect(pending.length).toBe(1);
		await gates.resolveApproval(pending[0]?.id ?? "", "approved", "boss");

		const done = await resumable.resume(waiting.runId, {
			kind: "approval",
			payload: {},
			decision: "approved",
		});
		expect(done.status).toBe("completed");
		if (done.status === "completed") expect(done.result).toBe("published");
	});

	it("rejects duplicate registration and unknown definitions", async () => {
		const { resumable } = stack();
		resumable.register(counter);
		expect(() => resumable.register(counter)).toThrow();
		expect(resumable.runToYield("missing", {})).rejects.toThrow();
	});

	it("audits every transition in the ledger", async () => {
		const { resumable, db } = stack();
		resumable.register(counter);
		const waiting = await resumable.runToYield("counter", { n: 0 });
		if (waiting.status !== "waiting") throw new Error("unreachable");
		await resumable.resume(waiting.runId, {
			kind: "event",
			eventName: "counter.tick",
			payload: {},
		});
		const kinds = db.events.map((row) => row.kind);
		expect(kinds).toContain("resumable.yielded");
		expect(
			kinds.filter((kind) => kind === "resumable.yielded").length,
		).toBeGreaterThanOrEqual(2);
	});
});

describe("message cleaner (inbound redelivery dedupe)", () => {
	const base = {
		provider: "whatsapp",
		threadId: "t1",
		senderHandle: "User-9",
		body: "Hello",
		occurredAt: new Date(1_760_000_000_000),
	};

	it("fingerprints normalize case and whitespace", () => {
		const a = messageFingerprint(base);
		const b = messageFingerprint({
			...base,
			senderHandle: " user-9 ",
			body: "Hello ",
		});
		expect(a).toBe(b);
	});

	it("flags redeliveries inside the window and not outside", () => {
		const fingerprint = messageFingerprint(base);
		expect(
			isRedelivery(base, {
				fingerprint,
				occurredAt: new Date(1_760_000_030_000),
			}),
		).toBe(true);
		expect(
			isRedelivery(base, {
				fingerprint,
				occurredAt: new Date(1_760_000_120_000),
			}),
		).toBe(false);
		expect(
			isRedelivery(
				{ ...base, body: "Different" },
				{ fingerprint, occurredAt: base.occurredAt },
			),
		).toBe(false);
	});
});
