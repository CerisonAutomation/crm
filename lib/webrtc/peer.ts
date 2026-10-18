/**
 * Shared WebRTC primitives for the P2P trust surfaces.
 *
 * Used by BOTH `useP2PCall` (1:1 case calling) and `useMeshCall` (multi-party
 * team meetings). Media stays peer-to-peer in both topologies; the server only
 * relays SDP/ICE rows over the authenticated REST endpoints and never sees a
 * media byte. SDP/candidate values pass straight to/from `RTCPeerConnection`
 * and are never logged, uploaded or stored here.
 *
 * Deliberately NOT shared (kept per-topology in the hooks): the glare rules.
 * 1:1 uses caller-offers (`isCaller`); the mesh uses the deterministic
 * lexicographic rule (`me < peerId` offers). Both sides of a pair apply the
 * same comparison to the same two ids, so they always agree who offers without
 * an extra handshake. Do not "unify" those — the topologies differ.
 *
 * Pure client-safe module: no Prisma, no server imports, no framework imports.
 */

export type IceServersResponse = { iceServers: unknown };

/** Public STUN fallback — used only if the server ICE lookup fails. */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"],
  },
];

/**
 * Resolve ICE servers from the server, where TURN credentials are minted.
 * The fetcher is injected so this helper never imports the API client
 * (keeps the module pure and unit-testable). Any failure falls back to
 * public STUN so a call can still be attempted; the relay is simply
 * unavailable, which is the safe degradation.
 */
export async function resolveIceServers(
  fetchIce: () => Promise<IceServersResponse>
): Promise<RTCIceServer[]> {
  try {
    const { iceServers } = await fetchIce();
    if (Array.isArray(iceServers) && iceServers.length > 0) {
      return iceServers as RTCIceServer[];
    }
  } catch {
    /* transient failure — fall through to STUN */
  }
  return FALLBACK_ICE_SERVERS;
}

/**
 * Pending-ICE queue: candidates that arrive before the remote description is
 * set cannot be added yet, so they wait here. `flush` drains them onto the
 * live connection; a stale/replayed candidate must never fail the call.
 */
export function createIceQueue() {
  let pending: RTCIceCandidateInit[] = [];
  return {
    /** Park a candidate until the remote description lands. */
    queue(candidate: RTCIceCandidateInit): void {
      pending.push(candidate);
    },
    /** Number of parked candidates (useful for tests/diagnostics). */
    get size(): number {
      return pending.length;
    },
    /** Drop everything without touching the connection. */
    clear(): void {
      pending = [];
    },
    /** Add every parked candidate; failures are swallowed per-candidate. */
    async flush(pc: RTCPeerConnection): Promise<void> {
      const queued = pending;
      pending = [];
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* stale/replayed candidate — must not fail the call */
        }
      }
    },
  };
}

export type IceQueue = ReturnType<typeof createIceQueue>;

/**
 * Poll-loop re-entrancy guard: the 1 s short-poll must never overlap itself
 * (a slow response would otherwise stack concurrent polls and reorder seqs).
 */
export function createPollGuard() {
  let inFlight = false;
  return {
    /** True when a poll may start (marks the guard busy). */
    begin(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    /** Release the guard after a poll settles. */
    end(): void {
      inFlight = false;
    },
    /** Force-release (teardown path). */
    reset(): void {
      inFlight = false;
    },
  };
}

export type PollGuard = ReturnType<typeof createPollGuard>;

/** Stop every track of a local stream (mic/camera release). Safe on null. */
export function stopLocalStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  }
}

/**
 * Idempotent peer teardown: detach handlers, close the connection, release
 * the local media. Never throws — teardown runs on unmount, hangup and
 * failure paths where a throw would mask the real outcome.
 */
export function closePeerConnection(
  pc: RTCPeerConnection | null | undefined,
  localStream?: MediaStream | null
): void {
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
  }
  stopLocalStream(localStream ?? null);
}

/** Detach a media element (clears a stale frame on teardown/peer removal). */
export function clearVideoElement(
  el: HTMLVideoElement | null | undefined
): void {
  if (el) el.srcObject = null;
}
