import { describe, expect, it } from "bun:test";
import { SendClaimService } from "../src/workflows/send-claim.service";

type Row = Record<string, unknown> & { id: string };

class InMemoryClaimsDb {
	rows: Row[] = [];
	private seq = 0;

	sendClaim = {
		create: async ({ data }: { data: Row & { channel: string; kind: string; stepNumber: number; idempotencyKey: string } }) => {
			const dup = this.rows.find(
				(row) =>
					row.channel === data.channel &&
					row.kind === data.kind &&
					row.stepNumber === data.stepNumber &&
					row.idempotencyKey === data.idempotencyKey,
			);
			if (dup) {
				const error = new Error("Unique constraint failed") as Error & { code: string };
				error.code = "P2002";
				throw error;
			}
			const row = { ...data, id: data.id ?? `claim-${++this.seq}`, claimedAt: new Date() };
			this.rows.push(row);
			return row;
		},
		findUnique: async ({ where }: { where: Record<string, { channel: string; kind: string; stepNumber: number; idempotencyKey: string }> }) => {
			const key = where.channel_kind_stepNumber_idempotencyKey as {
				channel: string;
				kind: string;
				stepNumber: number;
				idempotencyKey: string;
			};
			return (
				this.rows.find(
					(row) =>
						row.channel === key.channel &&
						row.kind === key.kind &&
						row.stepNumber === key.stepNumber &&
						row.idempotencyKey === key.idempotencyKey,
				) ?? null
			);
		},
		updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
			const hits = this.rows.filter((row) =>
				Object.entries(where).every(([key, value]) => row[key] === value),
			);
			for (const row of hits) Object.assign(row, data);
			return { count: hits.length };
		},
		findMany: async ({ where }: { where: Record<string, unknown> }) =>
			this.rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)),
	};
}

function service(): { claims: SendClaimService; db: InMemoryClaimsDb } {
	const db = new InMemoryClaimsDb();
	return { claims: new SendClaimService(db as never), db };
}

const key = {
	channel: "whatsapp",
	kind: "channel.message",
	stepNumber: 1,
	idempotencyKey: "run-42:step-1",
	ownerUserId: "user-1",
};

describe("SendClaimService (double-send lock)", () => {
	it("only the first claim wins and may execute", async () => {
		const { claims } = service();
		const first = await claims.claim(key);
		expect(first.outcome).toBe("claimed");
		const second = await claims.claim(key);
		expect(second.outcome).toBe("already-claimed");
	});

	it("runWithClaim executes once and skips duplicates", async () => {
		const { claims, db } = service();
		let executions = 0;

		const runOnce = async () => {
			return claims.runWithClaim(
				key,
				async () => {
					executions += 1;
					return { externalMessageId: "m-1" };
				},
				(value) => value.externalMessageId,
			);
		};

		const first = await runOnce();
		expect(first.outcome).toBe("executed");
		const second = await runOnce();
		expect(second.outcome).toBe("skipped");
		expect(executions).toBe(1);
		expect(db.rows[0]?.outcome).toBe("sent");
		expect(db.rows[0]?.providerReference).toBe("m-1");
	});

	it("keeps failed claims (asymmetric divergence policy)", async () => {
		const { claims, db } = service();
		const result = await claims.runWithClaim(key, async () => {
			throw new Error("provider 500");
		});
		expect(result.outcome).toBe("failed");
		expect(db.rows[0]?.outcome).toBe("failed");
		expect(String(db.rows[0]?.lastError)).toContain("provider 500");

		const retry = await claims.runWithClaim(key, async () => "never");
		expect(retry.outcome).toBe("skipped");
	});

	it("surfaces contended unique-violations as already-claimed", async () => {
		const { claims, db } = service();
		// Simulate a race: the row exists between findUnique and create by
		// pre-inserting with the same natural key via a second service instance.
		const racer = new SendClaimService(db as never);
		await racer.claim(key);
		const mine = await claims.claim(key);
		expect(mine.outcome).toBe("already-claimed");
	});

	it("lists unresolved unknown claims for ops reconciliation", async () => {
		const { claims, db } = service();
		await claims.claim(key);
		const unresolved = await claims.unresolvedClaims();
		expect(unresolved.length).toBe(1);
		expect(db.rows[0]?.outcome).toBe("unknown");
	});
});
