import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * GET /api/calls/ice — the WebRTC ICE server list for the authenticated caller.
 *
 * Credentials are resolved SERVER-SIDE only. They must never be exposed as
 * `NEXT_PUBLIC_*` variables (which are inlined into the client bundle), because
 * a leaked static TURN credential lets anyone relay arbitrary traffic through
 * the relay.
 *
 * TURN precedence:
 *   1. TURN_URL + TURN_STATIC_SECRET → coturn REST API: a per-user, time-limited
 *      credential (username = `<expiry>:<userId>`, credential = base64(HMAC-SHA1)).
 *      The relay re-derives the same HMAC to authenticate the allocation.
 *   2. TURN_URL + TURN_USER + TURN_CREDENTIAL → a static relay credential that
 *      still lives only on the server (never in the bundle).
 *   3. TURN_URL only → STUN-only (no relay) so we never ship an unauthenticated
 *      relay.
 * Public STUN servers are always included.
 */

/** Public STUN is the safe, credential-free default — always available. */
const STUN_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] },
];

/** Lifetime of a minted TURN credential, in seconds. */
const TURN_TTL_SECONDS = 3_600;

type IceServer = { urls: string[]; username?: string; credential?: string };

/**
 * coturn REST API credential: the username carries the expiry so the relay can
 * validate the HMAC and reject reused creds after they expire.
 */
function mintTurnCredential(userId: string): { username: string; credential: string } | null {
  const secret = env.TURN_STATIC_SECRET?.trim();
  if (!secret) return null;
  const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential };
}

function resolveIceServers(userId: string): IceServer[] {
  const servers: IceServer[] = [...STUN_SERVERS];
  const turnUrl = env.TURN_URL?.trim();
  if (!turnUrl) return servers;

  const minted = mintTurnCredential(userId);
  if (minted) {
    servers.push({ urls: [turnUrl], username: minted.username, credential: minted.credential });
    return servers;
  }

  const user = env.TURN_USER?.trim();
  const credential = env.TURN_CREDENTIAL?.trim();
  if (user && credential) {
    servers.push({ urls: [turnUrl], username: user, credential });
  }
  return servers;
}

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    return jsonOk({
      iceServers: resolveIceServers(ctx.userId),
      ttl: env.TURN_STATIC_SECRET ? TURN_TTL_SECONDS : null,
    });
  })(req);
}
