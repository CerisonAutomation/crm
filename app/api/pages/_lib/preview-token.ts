import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Session-free DRAFT PREVIEW links for Lane Pages.
 *
 * A reviewer (an RM who can read a page but cannot publish it) needs to SEE a
 * draft as it will render. Rather than invent a new session type, this reuses the
 * repo's existing signed-token pattern (`lib/services/ics.ts`,

`lib/services/calendar-feed.ts`): an HMAC-SHA256 token bound to the page slug
 * AND an expiry, keyed on `AUTH_SECRET`.
 *
 * Fail CLOSED: when `AUTH_SECRET` is absent or weaker than 16 chars, no token is
 * minted and every verification is refused — a preview link can never exist on a
 * host that cannot sign one. The expiry is baked into the signature, so a leaked
 * link stops working on its own and cannot be replayed indefinitely.
 */

/** Preview links live for one hour — long enough to review, short enough to leak safely. */
export const PAGE_PREVIEW_TTL_MS = 60 * 60 * 1000;

function signingSecret(): string | null {
  const configured = env.AUTH_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : null;
}

/** Pure HMAC over `page-preview:<slug>:<expiresAtMs>` (32 hex chars). */
export function signPagePreviewToken(secret: string, slug: string, expiresAtMs: number): string {
  return createHmac("sha256", secret).update(`page-preview:${slug}:${expiresAtMs}`).digest("hex").slice(0, 32);
}

/** 
 * Mint `<expiresAtMs>.<hmac>` for a slug. Returns null when no signing secret is
 * configured — the caller must then treat preview links as unavailable.
 */
export function pagePreviewToken(slug: string, expiresAtMs: number = Date.now() + PAGE_PREVIEW_TTL_MS): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return `${expiresAtMs}.${signPagePreviewToken(secret, slug, expiresAtMs)}`;
}

/** 
 * Verify a token against an explicit secret (pure — used by tests).
 */
export function verifyPagePreviewTokenWithSecret(secret: string, slug: string, provided: string): boolean {
  const dot = provided.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(provided.slice(0, dot));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  const a = Buffer.from(provided.slice(dot + 1));
  const b = Buffer.from(signPagePreviewToken(secret, slug, expiresAtMs));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Constant-time verification of a preview token for a slug. Rejects malformed,
 * tampered and expired tokens, and fails closed when signing is unconfigured.
 * The token is bound to the slug, so a link signed for one page cannot unlock
 * another.
 */
export function verifyPagePreviewToken(slug: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const secret = signingSecret();
  if (!secret) return false;
  return verifyPagePreviewTokenWithSecret(secret, slug, provided);
}
