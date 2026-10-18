import { describe, expect, it } from "bun:test";
import {
	assertSafeUrl,
	isBlockedHost,
	SsrfBlockedError,
	ssrfSafeFetch,
	type FetchLike,
} from "../src/http/ssrf-safe-fetch";

describe("isBlockedHost", () => {
	it("blocks loopback, link-local, private and metadata hosts", () => {
		for (const host of [
			"localhost",
			"127.0.0.1",
			"127.1.2.3",
			"0.0.0.0",
			"10.0.0.5",
			"192.168.1.1",
			"172.16.0.1",
			"172.31.255.255",
			"169.254.169.254",
			"100.64.0.1",
			"::1",
			"[::1]",
			"fe80::1",
			"fd12::1",
			"metadata.google.internal",
			"db.internal",
			"printer.local",
		]) {
			expect(isBlockedHost(host)).toBe(true);
		}
	});

	it("allows public hosts", () => {
		for (const host of ["graph.facebook.com", "api.linkedin.com", "hooks.example.com", "8.8.8.8"]) {
			expect(isBlockedHost(host)).toBe(false);
		}
	});

	it("blocks embedded credentials and odd hosts", () => {
		expect(isBlockedHost("")).toBe(true);
		expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SsrfBlockedError);
		expect(() => assertSafeUrl("http://user:pass@evil.example.com/")).toThrow(SsrfBlockedError);
		expect(() => assertSafeUrl("not a url")).toThrow(SsrfBlockedError);
	});
});

describe("ssrfSafeFetch wrapper", () => {
	it("refuses blocked targets before any network call", async () => {
		let called = 0;
		const fake: FetchLike = async () => {
			called += 1;
			return { ok: true, status: 200, statusText: "OK", json: async () => ({}), text: async () => "" };
		};
		const guarded = ssrfSafeFetch(fake);
		await expect(guarded("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(SsrfBlockedError);
		expect(called).toBe(0);
	});

	it("passes public requests through with redirects disabled", async () => {
		const seen: Array<{ url: string; redirect?: string }> = [];
		const fake: FetchLike = async (url, init) => {
			seen.push({ url, redirect: init?.redirect });
			return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }), text: async () => "" };
		};
		const guarded = ssrfSafeFetch(fake);
		const response = await guarded("https://hooks.example.com/webhook", { method: "POST", body: "{}" });
		expect(response.status).toBe(200);
		expect(seen[0]?.url).toBe("https://hooks.example.com/webhook");
		expect(seen[0]?.redirect).toBe("manual");
	});

	it("blocks redirect-style smuggle via blocked host in the URL", async () => {
		const guarded = ssrfSafeFetch(async () => {
			throw new Error("must not be called");
		});
		await expect(guarded("https://public.example.com@localhost/steal")).rejects.toThrow(SsrfBlockedError);
	});
});
