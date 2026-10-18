import { describe, expect, it } from "bun:test";
import {
	assertPublishTransition,
	assertValidCodeVerifier,
	assertValidState,
	InvalidPublishTransition,
	missingScopes,
	publishPhaseAfterCheck,
	verifyLinkedinSignature,
	verifyMetaSignature,
	type PublishPhase,
} from "../src/channels/channel-contracts";
import { createHmac } from "node:crypto";

describe("PKCE + scope helpers", () => {
	it("rejects malformed code verifiers", () => {
		expect(() => assertValidCodeVerifier("short")).toThrow();
		expect(() => assertValidCodeVerifier("x".repeat(43))).not.toThrow();
	});

	it("requires long state values", () => {
		expect(() => assertValidState("tiny")).toThrow();
		expect(() => assertValidState("0123456789abcdef")).not.toThrow();
	});

	it("detects scope gaps", () => {
		expect(missingScopes(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
		expect(missingScopes(["a"], ["a"])).toEqual([]);
	});
});

describe("pending-publish state machine", () => {
	it("allows the documented lifecycle", () => {
		expect(() => assertPublishTransition("draft", "pending")).not.toThrow();
		expect(() => assertPublishTransition("pending", "pending")).not.toThrow();
		expect(() => assertPublishTransition("pending", "ready")).not.toThrow();
		expect(() => assertPublishTransition("ready", "completed")).not.toThrow();
		expect(() => assertPublishTransition("pending", "completed")).not.toThrow();
	});

	it("blocks regressions and terminal exits", () => {
		expect(() => assertPublishTransition("completed", "ready")).toThrow(InvalidPublishTransition);
		expect(() => assertPublishTransition("ready", "pending")).toThrow(InvalidPublishTransition);
		expect(() => assertPublishTransition("pending", "draft")).toThrow(InvalidPublishTransition);
	});

	it("advances phase after checks", () => {
		expect(publishPhaseAfterCheck("pending", { phase: "ready" })).toBe("ready" as PublishPhase);
		expect(publishPhaseAfterCheck("ready", { phase: "completed" })).toBe("completed" as PublishPhase);
	});
});

describe("webhook authenticity", () => {
	const rawBody = JSON.stringify({ entry: [{ id: "1" }] });
	const appSecret = "app-secret-123";

	it("accepts a valid Meta sha256 signature and rejects tampering", () => {
		const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
		expect(
			verifyMetaSignature({ rawBody, signatureHeader: signature, appSecret }),
		).toBe(true);
		expect(
			verifyMetaSignature({ rawBody: `${rawBody} `, signatureHeader: signature, appSecret }),
		).toBe(false);
		expect(verifyMetaSignature({ rawBody, signatureHeader: "sha256=beef", appSecret })).toBe(false);
		expect(verifyMetaSignature({ rawBody, signatureHeader: undefined, appSecret })).toBe(false);
	});

	it("accepts a valid LinkedIn base64 signature", () => {
		const signature = createHmac("sha256", "li-secret").update(rawBody, "utf8").digest("base64");
		expect(
			verifyLinkedinSignature({ rawBody, signatureHeader: signature, clientSecret: "li-secret" }),
		).toBe(true);
		expect(
			verifyLinkedinSignature({ rawBody, signatureHeader: signature, clientSecret: "wrong" }),
		).toBe(false);
	});
});
