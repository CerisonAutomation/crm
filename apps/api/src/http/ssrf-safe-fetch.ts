/**
 * SSRF-safe fetch (pattern harvested from Postiz `getSsrfSafeAxios`/dispatcher).
 *
 * Every outbound HTTP call from automation (webhooks, channel providers) must
 * route through this guard: http/https only; loopback, link-local, private and
 * metadata hosts are rejected by name and by IPv4/IPv6 literal; redirects are
 * not followed automatically by the guard (callers re-validate each hop).
 * DNS-level rebinding defense is delegated to the runtime resolver policy —
 * this guard enforces the URL-level contract and is pure/testable.
 */

export type FetchLike = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		redirect?: "manual" | "follow" | "error";
		signal?: AbortSignal;
	},
) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"localhost.localdomain",
	"metadata.google.internal",
	"metadata",
	"instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".metadata.google.internal"];

function isBlockedIpv4(hostname: string): boolean {
	const parts = hostname.split(".");
	if (parts.length !== 4) return false;
	const octets = parts.map((part) => Number(part));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
	const [a, b] = octets as [number, number, number, number];
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	return false;
}

function isBlockedIpv6(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (normalized === "::1" || normalized === "::") return true;
	if (normalized.startsWith("fe80:") || normalized.startsWith("fe80%")) return true;
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
	if (normalized.startsWith("::ffff:")) {
		const inner = normalized.slice("::ffff:".length);
		if (inner.includes(".")) return isBlockedIpv4(inner);
		return true;
	}
	return false;
}

export function isBlockedHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase().replace(/\.$/, "");
	if (host.length === 0) return true;
	if (BLOCKED_HOSTNAMES.has(host)) return true;
	if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
	if (host.includes(":") || host.startsWith("[")) return isBlockedIpv6(host);
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isBlockedIpv4(host);
	return false;
}

export class SsrfBlockedError extends Error {
	constructor(url: string, reason: string) {
		super(`Blocked outbound request to ${url}: ${reason}`);
		this.name = "SsrfBlockedError";
	}
}

export function assertSafeUrl(rawUrl: string): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SsrfBlockedError(rawUrl, "malformed URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new SsrfBlockedError(rawUrl, `unsupported protocol ${url.protocol}`);
	}
	if (isBlockedHost(url.hostname)) {
		throw new SsrfBlockedError(rawUrl, `blocked host ${url.hostname}`);
	}
	if (url.username || url.password) {
		throw new SsrfBlockedError(rawUrl, "embedded credentials");
	}
	return url;
}

/**
 * Wraps a fetch implementation with the URL contract. Each call validates the
 * target; redirect following is disabled so a public host cannot bounce the
 * request at a private one without re-validation.
 */
export function ssrfSafeFetch(fetcher: FetchLike): FetchLike {
	return async (input, init) => {
		assertSafeUrl(input);
		return fetcher(input, { ...init, redirect: "manual" });
	};
}
