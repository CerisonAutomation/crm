import { describe, expect, it } from "bun:test";
import {
	resolveEffectiveSoul,
	type SoulLayer,
} from "../src/soul/soul.service";
import {
	hashCode,
	isValidDomain,
	openSecret,
	sealSecret,
} from "../src/hardening/hardening-services";
import { WorkflowNonRetryableError } from "../src/workflows/workflow-errors";

function layer(id: string, parentId: string | null, over: Partial<SoulLayer> = {}): SoulLayer {
	return {
		id,
		parentId,
		name: `soul-${id}`,
		labels: {},
		tone: "professional",
		positioning: null,
		branding: {},
		...over,
	};
}

describe("resolveEffectiveSoul (white-label inheritance)", () => {
	it("merges root values under child overrides (deep for branding)", () => {
		const byId = new Map<string, SoulLayer>([
			[
				"root",
				layer("root", null, {
					labels: { deal: "Opportunity", contact: "Client" },
					branding: { colors: { primary: "#111111" }, logo: "root.png" },
					tone: "formal",
				}),
			],
			[
				"child",
				layer("child", "root", {
					labels: { deal: "Sale" },
					branding: { colors: { primary: "#ff5500" } },
					tone: "friendly",
					positioning: "Fast local plumber",
				}),
			],
		]);

		const soul = resolveEffectiveSoul("child", byId);
		expect(soul.labels).toEqual({ deal: "Sale", contact: "Client" });
		expect(soul.branding).toEqual({ colors: { primary: "#ff5500" }, logo: "root.png" });
		expect(soul.tone).toBe("friendly");
		expect(soul.positioning).toBe("Fast local plumber");
		expect(soul.chain).toEqual(["child", "root"]);
	});

	it("detects inheritance cycles", () => {
		const byId = new Map<string, SoulLayer>([
			["a", layer("a", "b")],
			["b", layer("b", "a")],
		]);
		expect(() => resolveEffectiveSoul("a", byId)).toThrow(WorkflowNonRetryableError);
	});

	it("throws for unknown souls", () => {
		expect(() => resolveEffectiveSoul("missing", new Map())).toThrow(WorkflowNonRetryableError);
	});
});

describe("secret vault crypto", () => {
	const key = Buffer.alloc(32, 7);

	it("round-trips through seal/open", () => {
		const sealed = sealSecret("super-secret-token", key);
		expect(sealed.ciphertext).not.toContain("super-secret-token");
		expect(openSecret(sealed, key)).toBe("super-secret-token");
	});

	it("fails on tampered ciphertext or auth tag", () => {
		const sealed = sealSecret("value", key);
		const tampered = { ...sealed, ciphertext: Buffer.from("different").toString("base64") };
		expect(() => openSecret(tampered, key)).toThrow();
		const tagTampered = { ...sealed, authTag: Buffer.alloc(16, 1).toString("base64") };
		expect(() => openSecret(tagTampered, key)).toThrow();
	});

	it("uses a fresh iv per seal", () => {
		const a = sealSecret("same", key);
		const b = sealSecret("same", key);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ciphertext).not.toBe(b.ciphertext);
	});
});

describe("domain validation + code hashing", () => {
	it("accepts real domains and rejects junk", () => {
		expect(isValidDomain("portal.acme.com")).toBe(true);
		expect(isValidDomain("acme.co.uk")).toBe(true);
		expect(isValidDomain("localhost")).toBe(false);
		expect(isValidDomain("evil..com")).toBe(false);
		expect(isValidDomain("http://acme.com")).toBe(false);
	});

	it("hashes codes deterministically and irreversibly", () => {
		const hash = hashCode("abcd1234");
		expect(hash).toBe(hashCode("abcd1234"));
		expect(hash).not.toContain("abcd1234");
		expect(hash.length).toBe(64);
		expect(hash).not.toBe(hashCode("abcd1235"));
	});
});
