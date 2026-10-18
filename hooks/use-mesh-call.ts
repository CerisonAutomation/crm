"use client";
/**
 * useMeshCall — multi-party WebRTC mesh for internal team meetings.
 *
 * One `RTCPeerConnection` per remote participant, keyed by userId. Media is
 * strictly peer-to-peer: the server only relays OFFER / ANSWER / ICE / HANGUP /
 * STATE rows through the authenticated REST endpoints
 * (`/api/meetings/[id]/signals`) and never sees a single media byte. SDP and ICE
 * values are passed straight to and from `RTCPeerConnection` and are never
 * logged, uploaded or stored — only the host's deliberate recording reaches the
 * vault (handled by the room, not here).
 *
 * Glare-free offer rule (deterministic and symmetric on both sides): for a pair
 * (me, peer) the participant whose userId compares lexicographically smaller
 * (`me < peerId`, plain JS string comparison) is the *initiator* and the only
 * side that ever creates the OFFER; the other side only ever answers. Both peers
 * apply the same comparison to the same two ids, so they always agree who offers
 * without any extra handshake.
 *
 * A symmetric-NAT or strict-firewall deployment needs a TURN relay. Credentials
 * are resolved SERVER-SIDE from the authenticated `GET /api/calls/ice` endpoint
 * and never from the client bundle: a static relay credential exposed as a
 * public env var would be inlined into public JavaScript and let anyone relay
 * traffic through the relay. Provision `TURN_URL` (with `TURN_STATIC_SECRET`,
 * or `TURN_USER` / `TURN_CREDENTIAL`) server-side; STUN alone is the fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type MeetingRow } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import {
  FALLBACK_ICE_SERVERS,
  clearVideoElement,
  closePeerConnection,
  createIceQueue,
  createPollGuard,
  resolveIceServers,
  type IceQueue,
} from "@/lib/webrtc/peer";

export type MeshPeer = {
  userId: string;
  name: string;
  role: string;
  stream: MediaStream | null;
  connection: RTCPeerConnectionState | "new";
  micOn: boolean;
  cameraOn: boolean;
};

export type MeshCallState = {
  phase: "idle" | "joining" | "connected" | "reconnecting" | "ended" | "failed";
  peers: MeshPeer[];
  localStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  error: string | null;
  durationSec: number;
  participantCount: number;
};

type SignalRow = {
  seq: number;
  fromUserId: string;
  kind: string;
  payload: string;
};

/** Per-peer connection bookkeeping (kept in a ref, never in React state). */
type PeerConn = {
  pc: RTCPeerConnection;
  /** Parked ICE candidates, drained once the remote description lands. */
  ice: IceQueue;
  remoteSet: boolean;
  stream: MediaStream | null;
  // Glare rule (mesh topology — do not unify with the 1:1 caller-offers rule):
  // the lexicographically smaller userId is the initiator and only side that
  // ever creates the OFFER; both peers apply the same comparison.
  initiator: boolean;
};

type Roster = { name: string; role: string; micOn: boolean; cameraOn: boolean };

/** 3 remote peers + me — the server hard-caps the room at 4. */
const MAX_REMOTE_PEERS = 3;

export function useMeshCall(input: {
  meetingId: string | null;
  kind: "AUDIO" | "VIDEO";
  active: boolean;
  isHost: boolean;
  onEnded?: (reason: string) => void;
}): {
  state: MeshCallState;
  attachLocal: (el: HTMLVideoElement | null) => void;
  attachPeerVideo: (userId: string, el: HTMLVideoElement | null) => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  leave: () => Promise<void>;
  endForEveryone: () => Promise<void>;
} {
  const { meetingId, kind, active, isHost } = input;
  const { t } = useI18n();
  const myId = useApp((s) => s.session?.id ?? null);

  const tRef = useRef(t);
  const onEndedRef = useRef(input.onEnded);
  const isHostRef = useRef(isHost);
  const meetingIdRef = useRef(meetingId);
  useEffect(() => {
    tRef.current = t;
    onEndedRef.current = input.onEnded;
    isHostRef.current = isHost;
    meetingIdRef.current = meetingId;
  });

  const [phase, setPhase] = useState<MeshCallState["phase"]>("idle");
  const [peers, setPeers] = useState<MeshPeer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(kind === "VIDEO");
  const [error, setError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);

  const connectionsRef = useRef<Map<string, PeerConn>>(new Map());
  const peersRef = useRef<Map<string, MeshPeer>>(new Map());
  const rosterRef = useRef<Map<string, Roster>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localElRef = useRef<HTMLVideoElement | null>(null);
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastSeqRef = useRef(0);
  // Shared poll re-entrancy guard (see lib/webrtc/peer).
  const pollGuardRef = useRef(createPollGuard());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinedRef = useRef(false);
  const endedRef = useRef(false);
  const disposedRef = useRef(false);
  // Per-peer ICE-restart attempts (initiator side only). The first re-offer
  // goes out immediately; a second attempt follows after a short delay so a
  // slow ICE agent still gets a fresh chance. After that the tile stays as-is.
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const RECONNECT_MAX_ATTEMPTS = 2;
  const teardownRef = useRef<() => void>(() => undefined);

  // duration — tick once per second while connected, reset otherwise.
  useEffect(() => {
    if (phase !== "connected") {
      void Promise.resolve().then(() => setDurationSec(0));
      return;
    }
    const timer = setInterval(() => setDurationSec((d) => d + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!active || !meetingId || !myId) return;
    const id = meetingId;
    const me = myId;

    disposedRef.current = false;
    endedRef.current = false;
    joinedRef.current = false;
    lastSeqRef.current = 0;
    pollGuardRef.current.reset();
    reconnectAttemptsRef.current = new Map();

    void Promise.resolve().then(() => {
      if (disposedRef.current) return;
      setPhase("joining");
      setError(null);
      setDurationSec(0);
    });

    // ICE servers are resolved from the server inside `start()` before any peer
    // is created; STUN is the safe default until that resolves.
    let iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;

    const commitPeers = () => setPeers([...peersRef.current.values()]);

    const attachStream = (userId: string) => {
      const el = videoElsRef.current.get(userId);
      if (el) el.srcObject = connectionsRef.current.get(userId)?.stream ?? null;
    };

    const upsertPeer = (userId: string, patch: Partial<MeshPeer>) => {
      const prev = peersRef.current.get(userId);
      const meta = rosterRef.current.get(userId);
      const next: MeshPeer = {
        userId,
        name: patch.name ?? prev?.name ?? meta?.name ?? "—",
        role: patch.role ?? prev?.role ?? meta?.role ?? "MEMBER",
        stream: patch.stream ?? prev?.stream ?? null,
        connection: patch.connection ?? prev?.connection ?? "new",
        micOn: patch.micOn ?? prev?.micOn ?? meta?.micOn ?? true,
        cameraOn: patch.cameraOn ?? prev?.cameraOn ?? meta?.cameraOn ?? false,
      };
      peersRef.current.set(userId, next);
      commitPeers();
    };

    const recomputePhase = () => {
      if (disposedRef.current || endedRef.current) return;
      const states = [...connectionsRef.current.values()].map(
        (c) => c.pc.connectionState
      );
      setPhase(
        states.some((s) => s === "failed" || s === "disconnected")
          ? "reconnecting"
          : "connected"
      );
    };

    // Drain candidates that arrived before the remote description landed.
    const flushIce = async (conn: PeerConn) => {
      await conn.ice.flush(conn.pc);
    };

    const closePeer = (userId: string) => {
      const conn = connectionsRef.current.get(userId);
      if (conn) {
        // Local media is shared across peers — only the connection closes here.
        closePeerConnection(conn.pc);
        connectionsRef.current.delete(userId);
      }
    };

    const removePeer = (userId: string) => {
      closePeer(userId);
      const el = videoElsRef.current.get(userId);
      if (el) {
        clearVideoElement(el);
        videoElsRef.current.delete(userId);
      }
      if (peersRef.current.delete(userId)) commitPeers();
    };

    const ensurePeer = (userId: string): PeerConn => {
      const existing = connectionsRef.current.get(userId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers });
      const conn: PeerConn = {
        pc,
        ice: createIceQueue(),
        remoteSet: false,
        stream: null,
        initiator: me < userId,
      };

      const ls = localStreamRef.current;
      if (ls) ls.getTracks().forEach((track) => pc.addTrack(track, ls));

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        void api
          .meetingSignal(id, {
            toUserId: userId,
            kind: "ICE",
            payload: { candidate: event.candidate.toJSON() },
          })
          .catch(() => undefined);
      };

      pc.ontrack = (event) => {
        let stream = conn.stream;
        if (!stream) {
          stream = event.streams[0] ?? new MediaStream();
          conn.stream = stream;
        }
        const tracks = event.streams[0]
          ? event.streams[0].getTracks()
          : [event.track];
        for (const track of tracks)
          if (!stream.getTracks().includes(track)) stream.addTrack(track);
        upsertPeer(userId, { stream });
        attachStream(userId);
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        upsertPeer(userId, { connection: state });
        if (state === "failed" || state === "disconnected") {
          // Up to RECONNECT_MAX_ATTEMPTS re-offers, initiator only — the other
          // side resets when it receives the fresh OFFER. The first re-offer
          // is immediate, the second follows after a delay for a slow ICE
          // agent. Past the budget the tile stays as-is.
          if (conn.initiator) {
            const tries = reconnectAttemptsRef.current.get(userId) ?? 0;
            if (tries < RECONNECT_MAX_ATTEMPTS) {
              reconnectAttemptsRef.current.set(userId, tries + 1);
              if (tries === 0) {
                void restartPeer(userId);
              } else {
                setTimeout(() => {
                  if (!disposedRef.current) void restartPeer(userId);
                }, 1500);
              }
            }
          }
          recomputePhase();
        } else if (state === "connected") {
          recomputePhase();
        }
      };

      connectionsRef.current.set(userId, conn);
      upsertPeer(userId, { connection: "new" });
      return conn;
    };

    const resetPeerConnection = (userId: string): PeerConn => {
      closePeer(userId);
      return ensurePeer(userId);
    };

    const startOffer = async (userId: string, restart = false) => {
      const conn = connectionsRef.current.get(userId);
      if (!conn || !conn.initiator || disposedRef.current) return;
      try {
        // ICE-restart re-offers gather fresh candidates instead of reusing
        // the dead pair; initial offers use the plain form.
        if (restart) conn.pc.restartIce();
        const offer = await conn.pc.createOffer(
          restart ? { iceRestart: true } : undefined
        );
        if (disposedRef.current) return;
        await conn.pc.setLocalDescription(offer);
        await api.meetingSignal(id, {
          toUserId: userId,
          kind: "OFFER",
          payload: { sdp: offer.sdp, type: offer.type },
        });
      } catch {
        /* transient — a later renegotiation retries */
      }
    };

    const restartPeer = async (userId: string) => {
      if (disposedRef.current) return;
      resetPeerConnection(userId);
      upsertPeer(userId, { connection: "connecting" });
      await startOffer(userId, true);
      recomputePhase();
    };

    const syncParticipants = (list: MeetingRow["participants"]) => {
      for (const p of list) {
        rosterRef.current.set(p.userId, {
          name: p.name,
          role: p.role,
          micOn: p.micOn,
          cameraOn: p.cameraOn,
        });
      }
      const others = list
        .filter((p) => p.userId !== me)
        .slice(0, MAX_REMOTE_PEERS);
      const present = new Set(others.map((p) => p.userId));

      for (const userId of [...connectionsRef.current.keys()]) {
        if (!present.has(userId)) removePeer(userId);
      }
      for (const p of others) {
        const existed = connectionsRef.current.has(p.userId);
        if (!existed) {
          ensurePeer(p.userId);
          void startOffer(p.userId);
        }
        upsertPeer(p.userId, { name: p.name, role: p.role });
      }
    };

    const applySignal = async (row: SignalRow) => {
      const peerId = row.fromUserId;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        return;
      }
      const meta = rosterRef.current.get(peerId);

      if (row.kind === "OFFER") {
        let conn = connectionsRef.current.get(peerId);
        if (conn?.remoteSet) conn = resetPeerConnection(peerId); // fresh renegotiation
        conn = conn ?? ensurePeer(peerId);
        upsertPeer(peerId, { name: meta?.name, role: meta?.role });
        await conn.pc.setRemoteDescription({
          type: "offer",
          sdp: String(data.sdp ?? ""),
        });
        conn.remoteSet = true;
        await flushIce(conn);
        const answer = await conn.pc.createAnswer();
        await conn.pc.setLocalDescription(answer);
        await api
          .meetingSignal(id, {
            toUserId: peerId,
            kind: "ANSWER",
            payload: { sdp: answer.sdp, type: answer.type },
          })
          .catch(() => undefined);
      } else if (row.kind === "ANSWER") {
        const conn = connectionsRef.current.get(peerId) ?? ensurePeer(peerId);
        // Restart answers arrive while a re-offer is outstanding; stale
        // replays after the connection settled must not touch it.
        if (conn.remoteSet && conn.pc.signalingState !== "have-local-offer")
          return;
        await conn.pc.setRemoteDescription({
          type: "answer",
          sdp: String(data.sdp ?? ""),
        });
        conn.remoteSet = true;
        await flushIce(conn);
      } else if (row.kind === "ICE") {
        const conn = connectionsRef.current.get(peerId) ?? ensurePeer(peerId);
        const candidate = data.candidate as RTCIceCandidateInit | undefined;
        if (!candidate) return;
        if (!conn.remoteSet) {
          conn.ice.queue(candidate);
        } else {
          try {
            await conn.pc.addIceCandidate(candidate);
          } catch {
            /* ignore a queued-error candidate rather than failing the call */
          }
        }
      } else if (row.kind === "HANGUP") {
        removePeer(peerId);
      } else if (row.kind === "STATE") {
        upsertPeer(peerId, { micOn: !!data.micOn, cameraOn: !!data.cameraOn });
      }
    };

    const poll = async () => {
      if (disposedRef.current || endedRef.current) return;
      if (!pollGuardRef.current.begin()) return;
      try {
        const res = await api.meetingSignals(id, lastSeqRef.current);
        for (const row of res.signals) {
          await applySignal(row);
          lastSeqRef.current = Math.max(lastSeqRef.current, row.seq);
        }
        syncParticipants(res.participants);
        if (res.status === "ENDED") finish("ended");
      } catch {
        /* transient poll failure — retried on the next tick */
      } finally {
        pollGuardRef.current.end();
      }
    };

    /** Single idempotent teardown — clears the interval, closes every pc, stops
     *  every local track and detaches every <video> srcObject. */
    const teardown = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      pollGuardRef.current.reset();
      for (const userId of [...connectionsRef.current.keys()])
        closePeer(userId);
      connectionsRef.current.clear();
      closePeerConnection(null, localStreamRef.current);
      localStreamRef.current = null;
      for (const el of videoElsRef.current.values()) clearVideoElement(el);
      videoElsRef.current.clear();
      clearVideoElement(localElRef.current);
      peersRef.current.clear();
      rosterRef.current.clear();
      reconnectAttemptsRef.current.clear();
      void Promise.resolve().then(() => {
        setPeers([]);
        setLocalStream(null);
      });
    };
    teardownRef.current = teardown;

    const finish = (reason: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      teardown();
      setPhase("ended");
      onEndedRef.current?.(reason);
    };

    const start = async () => {
      // Fetch the relay config before joining so the first peer already has it.
      // TURN credentials are minted server-side; STUN is the safe fallback.
      iceServers = await resolveIceServers(() => api.iceServers());
      if (disposedRef.current) return;
      try {
        await api.meetingAction(id, { action: "join" });
      } catch (e) {
        if (disposedRef.current) return;
        const message = e instanceof Error ? e.message : "";
        setError(
          /ended/i.test(message)
            ? tRef.current("meeting.ended")
            : tRef.current("meeting.full")
        );
        setPhase("failed");
        return;
      }
      joinedRef.current = true;
      if (disposedRef.current) {
        joinedRef.current = false;
        void api.meetingAction(id, { action: "leave" }).catch(() => undefined);
        return;
      }

      try {
        if (
          globalThis.navigator === undefined ||
          !navigator.mediaDevices?.getUserMedia
        ) {
          setError(tRef.current("call.unsupported"));
          setPhase("failed");
          joinedRef.current = false;
          void api
            .meetingAction(id, { action: "leave" })
            .catch(() => undefined);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video:
            kind === "VIDEO"
              ? { width: { ideal: 1280 }, facingMode: "user" }
              : false,
        });
        if (disposedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          joinedRef.current = false;
          void api
            .meetingAction(id, { action: "leave" })
            .catch(() => undefined);
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMicEnabled(stream.getAudioTracks().every((track) => track.enabled));
        setCameraEnabled(
          kind === "VIDEO" &&
            stream.getVideoTracks().every((track) => track.enabled)
        );
        if (localElRef.current) {
          localElRef.current.muted = true;
          localElRef.current.srcObject = stream;
        }

        recomputePhase();

        intervalRef.current = setInterval(() => {
          void poll();
        }, 1000);
        void poll();
      } catch (err) {
        if (disposedRef.current) return;
        const denied =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        setError(
          denied
            ? tRef.current(
                kind === "VIDEO" ? "call.permissionDenied" : "team.micDenied"
              )
            : tRef.current("meeting.connectionFailed")
        );
        setPhase("failed");
        // No half-joined state: release the room immediately.
        joinedRef.current = false;
        void api.meetingAction(id, { action: "leave" }).catch(() => undefined);
        teardown();
      }
    };

    void start();

    return () => {
      disposedRef.current = true;
      teardown();
    };
  }, [active, meetingId, kind, myId]);

  const attachLocal = useCallback((el: HTMLVideoElement | null) => {
    localElRef.current = el;
    if (el) {
      el.muted = true;
      el.srcObject = localStreamRef.current;
    }
  }, []);

  const attachPeerVideo = useCallback(
    (userId: string, el: HTMLVideoElement | null) => {
      if (el) {
        videoElsRef.current.set(userId, el);
        el.srcObject = connectionsRef.current.get(userId)?.stream ?? null;
      } else {
        videoElsRef.current.delete(userId);
      }
    },
    []
  );

  const toggleMic = useCallback(() => {
    const ls = localStreamRef.current;
    if (!ls) return;
    const enabled = !ls.getAudioTracks().every((track) => track.enabled);
    ls.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setMicEnabled(enabled);
    const id = meetingIdRef.current;
    if (id) {
      const videoTracks = ls.getVideoTracks();
      const cameraOn =
        videoTracks.length > 0 && videoTracks.every((track) => track.enabled);
      void api
        .meetingSignal(id, {
          toUserId: null,
          kind: "STATE",
          payload: { micOn: enabled, cameraOn },
        })
        .catch(() => undefined);
    }
  }, []);

  const toggleCamera = useCallback(() => {
    const ls = localStreamRef.current;
    if (!ls) return;
    const tracks = ls.getVideoTracks();
    if (tracks.length === 0) return;
    const enabled = !tracks.every((track) => track.enabled);
    tracks.forEach((track) => {
      track.enabled = enabled;
    });
    setCameraEnabled(enabled);
    const id = meetingIdRef.current;
    if (id) {
      const micOn = ls.getAudioTracks().every((track) => track.enabled);
      void api
        .meetingSignal(id, {
          toUserId: null,
          kind: "STATE",
          payload: { micOn, cameraOn: enabled },
        })
        .catch(() => undefined);
    }
  }, []);

  const leave = useCallback(async () => {
    const id = meetingIdRef.current;
    if (id) {
      for (const userId of [...connectionsRef.current.keys()]) {
        await api
          .meetingSignal(id, { toUserId: userId, kind: "HANGUP", payload: {} })
          .catch(() => undefined);
      }
      await api.meetingAction(id, { action: "leave" }).catch(() => undefined);
    }
    endedRef.current = true;
    teardownRef.current();
    setPhase("ended");
  }, []);

  const endForEveryone = useCallback(async () => {
    const id = meetingIdRef.current;
    if (id && isHostRef.current)
      await api.meetingAction(id, { action: "end" }).catch(() => undefined);
    endedRef.current = true;
    teardownRef.current();
    setPhase("ended");
  }, []);

  return {
    state: {
      phase,
      peers,
      localStream,
      micEnabled,
      cameraEnabled,
      error,
      durationSec,
      participantCount: peers.length + 1,
    },
    attachLocal,
    attachPeerVideo,
    toggleMic,
    toggleCamera,
    leave,
    endForEveryone,
  };
}
