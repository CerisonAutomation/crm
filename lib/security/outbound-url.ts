/**
 * Outbound URL guard — the ONE shared, synchronous defence against SSRF
 * (CWE-918) for every place the platform issues a server-side request to a URL
 * that is not a compile-time literal.
 *
 * WHY THIS EXISTS
 * The platform fetches admin-configured URLs in two places — the outbound
 * webhook deliverer (`src/lib/integrations/webhooks.ts`) and the WhatsApp
 * "webhook" transport (`src/lib/integrations/index.ts`). Both destinations are
 * stored in the database and can be changed from the admin console, so they are
 * NOT trustworthy input even though a privileged actor supplies them: a
 * mis-typed or maliciously chosen endpoint must never let a request reach
 * loopback, RFC 1918 space, link-local/cloud-metadata addresses (169.254.169.254),
 * an unspecified address, or a non-HTTP scheme such as file:/gopher:.
 *
 * WHAT IT IS
 * A pure, dependency-free function: no DNS, no I/O, no Prisma. It validates the
 * *shape* of the URL (scheme, host, port) and rejects any LITERAL prohibited
 * address. Because it never resolves names it can be unit-tested in isolation
 * (tests/outbound-url.test.ts). Hostnames that resolve to a private address are
 * caught by the caller's DNS-resolution step (see assertPublicWebhookTarget in
 * src/lib/integrations/webhooks.ts), which runs this check FIRST and only then
 * resolves.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * DNS rebinding (TOCTOU): a caller that resolves a name, then lets fetch()
 * resolve it AGAIN, is still exposed if an attacker's DNS answer changes between
 * the two lookups. Closing that fully requires pinning the resolved IP into the
 * socket connection (a custom undici dispatcher), which the Next.js fetch API
 * does not expose. It is documented as residual risk rather than hidden.
 */
import { isIP } from "node:net";

/** The only schemes the platform is ever willing to fetch over. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Ports accepted when a URL names one explicitly (default = 80/443). */
const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443];

/** Public error strings. They flow into delivery logs + OutboxEvent.error. */
export const OUTBOUND_URL_ERROR = {
  invalid: "blocked: invalid url",
  scheme: "blocked: scheme not allowed (http/https only)",
  noHost: "blocked: no host",
  blockedHost: "blocked: private/loopback address",
  port: "blocked: port not allowed",
} as const;

/** Private / loopback / link-local / metadata IPv4 ranges (RFC 1918 + metadata). */
export function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (unspecified / "this" network)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** Loopback / unspecified / unique-local / link-local IPv6 ranges. */
export function isBlockedIPv6(address: string): boolean {
  const addr = address.split("%")[0].toLowerCase();
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified

  // IPv4-mapped in dotted form ("::ffff:127.0.0.1") — check the embedded IPv4.
  const dotted = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return isBlockedIPv4(dotted[1]);

  // IPv4-mapped in canonical hex form ("::ffff:7f00:1" / "::ffff:a9fe:a9fe") —
  // WHATWG `new URL()` normalises the dotted form into this shape, so the guard
  // must understand it or `http://[::ffff:169.254.169.254]/` slips through.
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = Number.parseInt(hexMapped[1], 16);
    const lo = Number.parseInt(hexMapped[2], 16);
    return isBlockedIPv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
  }

  const firstHextet = addr.split(":")[0].padStart(4, "0");
  const value = Number.parseInt(firstHextet, 16);
  if (Number.isNaN(value)) return true;
  if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * Whether an IP literal is private / loopback / link-local / metadata.
 * Non-IP input is treated as blocked — callers must resolve hostnames first.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return true;
  const family = isIP(value);
  if (family === 4) return isBlockedIPv4(value);
  if (family === 6) return isBlockedIPv6(value);
  return true;
}

export type OutboundUrlOptions = {
  /** Explicitly permitted (non-default) TCP ports. Defaults to [80, 443]. */
  allowedPorts?: readonly number[];
};

export type OutboundUrlResult =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; error: string };

/**
 * Validate an outbound URL: http(s) only, a present public host, and a standard
 * port. Purely syntactic — a resolvable hostname is returned as `ok` and the
 * caller's DNS layer must confirm it does not resolve into private space.
 */
export function assertOutboundUrl(raw: string, opts: OutboundUrlOptions = {}): OutboundUrlResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: OUTBOUND_URL_ERROR.invalid };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: OUTBOUND_URL_ERROR.invalid };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, error: `${OUTBOUND_URL_ERROR.scheme}: ${url.protocol}` };
  }

  // WHATWG keeps the brackets on an IPv6 hostname ("[::1]"); strip them so the
  // literal checks see the bare address.
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) return { ok: false, error: OUTBOUND_URL_ERROR.noHost };
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { ok: false, error: OUTBOUND_URL_ERROR.blockedHost };
  }

  // The WHATWG parser folds :80/:443 into "" (the default port), so any non-empty
  // port here is an explicit, non-standard choice.
  if (url.port !== "") {
    const allowed = opts.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
    if (!allowed.includes(Number(url.port))) {
      return { ok: false, error: `${OUTBOUND_URL_ERROR.port}: ${url.port}` };
    }
  }

  // A literal IP host must not be private/loopback/link-local/unspecified.
  if (isIP(hostname) !== 0 && isBlockedAddress(hostname)) {
    return { ok: false, error: OUTBOUND_URL_ERROR.blockedHost };
  }

  return { ok: true, url, hostname };
}
