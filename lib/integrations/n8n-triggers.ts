/**
 * n8n trigger authentication — the token rules, isolated from the route so they
 * can be proven without a database or a running server.
 *
 * Two sources, in priority order:
 *
 * 1. `INTERNAL_AUTOMATION_TOKEN` — the deployment-wide machine token. Present on
 *    a headless install where an administrator never opened the console.
 * 2. The `n8n` connector's `apiKey`, resolved per request from the encrypted
 *    integration setting (so rotating it in the console takes effect at once).
 *
 * Fail-closed is the whole design: no source configured means NO caller is
 * accepted — an instance with a half-filled connector card is not an open door.
 */
import { timingSafeEqual } from "node:crypto";

/** Constant-time bearer compare that never throws on a length mismatch. */
export function verifyN8nToken(header: string | null, expected: string | null): boolean {
  if (!expected) return false;
  const presented = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The token a machine caller must present, from the two configured sources. */
export function n8nTokenFromSources(
  envToken: string | null | undefined,
  connectorKey: string | null | undefined,
): string | null {
  const env = typeof envToken === "string" ? envToken.trim() : "";
  if (env) return env;
  const key = typeof connectorKey === "string" ? connectorKey.trim() : "";
  return key || null;
}
