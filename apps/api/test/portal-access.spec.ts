import { describe, expect, it } from "bun:test";
import {
	hashCode,
	PortalAccessService,
} from "../src/hardening/hardening-services";

type Row = Record<string, unknown> & { id: string };

class InMemoryPortalDb {
	rows: Row[] = [];
	private seq = 0;

	portalAccessCode = {
		create: async ({ data }: { data: Row }) => {
			const row = { createdAt: new Date(), usedCount: 0, revokedAt: null, ...data, id: data.id ?? `p-${++this.seq}` };
			this.rows.push(row);
			return row;
		},
		findUnique: async ({ where }: { where: { codeHash: string } }) =>
			this.rows.find((row) => row.codeHash === where.codeHash) ?? null,
		findMany: async ({ where = {} }: { where?: Record<string, unknown> }) =>
			this.rows.filter((row) =>
				Object.entries(where).every(([key, value]) => row[key] === value),
			),
		updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
			const hits = this.rows.filter((row) =>
				Object.entries(where).every(([key, value]) => {
					if (value === null) return row[key] === null;
					return row[key] === value;
				}),
			);
			for (const row of hits) Object.assign(row, data);
			return { count: hits.length };
		},
	};
}

function service(): { portal: PortalAccessService; db: InMemoryPortalDb } {
	const db = new InMemoryPortalDb();
	return { portal: new PortalAccessService(db as never), db };
}

describe("portal access codes (hashed + CAS consume)", () => {
	it("returns the raw code once and stores only its hash", async () => {
		const { portal, db } = service();
		const issued = await portal.issue("user-1", "Client portal", { maxUses: 2 });
		expect(issued.code.length).toBe(48);
		expect(db.rows[0]?.codeHash).toBe(hashCode(issued.code));
		expect(JSON.stringify(db.rows[0])).not.toContain(issued.code);
	});

	it("consumes up to maxUses exactly (CAS)", async () => {
		const { portal } = service();
		const issued = await portal.issue("user-1", "vip", { maxUses: 2 });

		const first = await portal.consume(issued.code);
		expect(first.ok).toBe(true);
		const second = await portal.consume(issued.code);
		expect(second.ok).toBe(true);
		const third = await portal.consume(issued.code);
		expect(third).toEqual({ ok: false, reason: "exhausted" });
	});

	it("rejects unknown, expired and revoked codes", async () => {
		const { portal } = service();
		expect(await portal.consume("nope")).toEqual({ ok: false, reason: "unknown_code" });

		const expired = await portal.issue("user-1", "old", {
			expiresAt: new Date(Date.now() - 1000),
		});
		expect(await portal.consume(expired.code)).toEqual({ ok: false, reason: "expired" });

		const revoked = await portal.issue("user-1", "revoke-me", {});
		expect(await portal.revoke("user-1", revoked.id)).toBe(true);
		expect(await portal.consume(revoked.code)).toEqual({ ok: false, reason: "revoked" });
		expect(await portal.revoke("user-1", revoked.id)).toBe(false);
	});

	it("validates issue options", async () => {
		const { portal } = service();
		expect(portal.issue("user-1", "bad", { maxUses: 0 })).rejects.toThrow();
		expect(portal.issue("user-1", "", {})).rejects.toThrow();
	});
});
