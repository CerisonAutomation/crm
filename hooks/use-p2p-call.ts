"use client";
/**
 * useP2PCall — one-to-one WebRTC audio/video for the case chat.
 *
 * Media is strictly peer-to-peer: the server only relays signaling (OFFER /
 * ANSWER / ICE / HANGUP) through the authenticated REST endpoints. Nothing here
 * uploads, records or logs a single media or SDP byte — SDP/candidate values are
 * passed straight to/from `RTCPeerConnection` and never console-logged.
 *
 * Signaling is a 1 s short-poll on `/api/calls/[id]/signals`, riding the same
 * bearer-token auth every other route uses (see docs/p2p-calling-research.md).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  clearVideoElement,
  closePeerConnection,
  createIceQueue,
  createPollGuard,
  resolveIceServers,
} from "@/lib/webrtc/peer";

export type P2PCallState = {
  phase:
    | "idle"
    | "negotiating"
    | "connected"
    | "reconnecting"
    | "failed"
    | "ended";
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  error: string | null;
  durationSec: number;
  peerCount: number; // 1 when a remote stream is live
};

type SignalRow = { seq: number; kind: string; payload: string };

export function useP2PCall(input: {
  callId: string | null;
  kind: "AUDIO" | "VIDEO";
  side: "CLIENT" | "STAFF" | null;
  isCaller: boolean;
  active: boolean; // false → the hook tears everything down
  onEnded?: (reason: string) => void;
  onSubtitle?: (line: { text: string; lang: string }) => void;
}) {
  const { callId, kind, side, isCaller, active } = input;
  const { t } = useI18n();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  // Live subtitle lines arrive over the same signaling channel as SDP/ICE.
  const onSubtitleRef = useRef(input.onSubtitle);
  useEffect(() => {
    onSubtitleRef.current = input.onSubtitle;
  });

  const [phase, setPhase] = useState<P2PCallState["phase"]>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(kind === "VIDEO");
  const [error, setError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [peerCount, setPeerCount] = useState(0);

  const onEndedRef = useRef(input.onEnded);
  useEffect(() => {
    onEndedRef.current = input.onEnded;
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteElRef = useRef<HTMLVideoElement | null>(null);
  const localElRef = useRef<HTMLVideoElement | null>(null);
  const lastSeqRef = useRef(0);
  // Shared poll re-entrancy guard + pending-ICE queue (see lib/webrtc/peer).
  const pollGuardRef = useRef(createPollGuard());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceQueueRef = useRef(createIceQueue());
  // ICE-restart reconnect attempts (caller side only). Reset on every
  // successful connection; the call only goes terminal after the budget below
  // is exhausted.
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 3;
  const remoteDescSetRef = useRef(false);
  const endedRef = useRef(false);
  const teardownRef = useRef<() => void>(() => undefined);

  // Assign the live streams to the overlay's media elements whenever either the
  // element or the stream changes; clear them on unmount.
  useEffect(() => {
    const el = remoteElRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    return () => {
      el.srcObject = null;
    };
  }, [remoteStream]);

  useEffect(() => {
    const el = localElRef.current;
    if (!el) return;
    el.muted = true;
    el.srcObject = localStream;
    return () => {
      el.srcObject = null;
    };
  }, [localStream]);

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
    if (!active || !callId || !side) return;
    const id = callId;

    endedRef.current = false;
    lastSeqRef.current = 0;
    pollGuardRef.current.reset();
    iceQueueRef.current.clear();
    remoteDescSetRef.current = false;
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    let disposed = false;

    // Drain candidates that arrived before the remote description landed.
    const flushIce = async () => {
      const pc = pcRef.current;
      if (!pc) return;
      await iceQueueRef.current.flush(pc);
    };

    const finish = (reason: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      teardownRef.current();
      setPhase("ended");
      onEndedRef.current?.(reason);
    };

    const applySignal = async (row: SignalRow) => {
      const pc = pcRef.current;
      if (!pc) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        return;
      }
      if (row.kind === "OFFER" && !isCaller) {
        // The first OFFER starts the call; later ones are ICE-restart
        // re-offers from the caller's reconnect loop — answer those too.
        await pc.setRemoteDescription({
          type: "offer",
          sdp: String(data.sdp ?? ""),
        });
        remoteDescSetRef.current = true;
        await flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await api.callSignal(id, "ANSWER", {
          sdp: answer.sdp,
          type: answer.type,
        });
      } else if (row.kind === "ANSWER" && isCaller) {
        // Only an answer to a locally-created (re-)offer applies: once the
        // peer connection is stable again the restart is done and stale
        // replays must not touch it.
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription({
          type: "answer",
          sdp: String(data.sdp ?? ""),
        });
        remoteDescSetRef.current = true;
        await flushIce();
      } else if (row.kind === "SUBTITLE") {
        const text = typeof data.text === "string" ? data.text : "";
        if (text)
          onSubtitleRef.current?.({
            text,
            lang: typeof data.lang === "string" ? data.lang : "",
          });
      } else if (row.kind === "ICE") {
        const candidate = data.candidate as RTCIceCandidateInit | undefined;
        if (!candidate) return;
        if (!remoteDescSetRef.current) {
          iceQueueRef.current.queue(candidate);
        } else {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            /* ignore a queued-error candidate rather than failing the call */
          }
        }
      } else if (row.kind === "HANGUP") {
        finish("remote-hung-up");
      }
    };

    const poll = async () => {
      if (disposed || endedRef.current) return;
      if (!pcRef.current) return;
      if (!pollGuardRef.current.begin()) return;
      try {
        const res = await api.callSignals(id, lastSeqRef.current);
        for (const row of res.signals) {
          await applySignal(row);
          lastSeqRef.current = Math.max(lastSeqRef.current, row.seq);
        }
        if (
          res.status === "DECLINED" ||
          res.status === "MISSED" ||
          res.status === "ENDED" ||
          res.status === "FAILED"
        ) {
          finish(res.status === "DECLINED" ? "declined" : "remote-hung-up");
        }
      } catch {
        /* transient poll failure — retried on the next tick */
      } finally {
        pollGuardRef.current.end();
      }
    };

    /** Single idempotent teardown — always stops local tracks and closes the peer. */
    const teardown = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      pollGuardRef.current.reset();
      const pc = pcRef.current;
      closePeerConnection(pc, localStreamRef.current);
      pcRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      iceQueueRef.current.clear();
      remoteDescSetRef.current = false;
      clearVideoElement(remoteElRef.current);
      clearVideoElement(localElRef.current);
      void Promise.resolve().then(() => {
        setLocalStream(null);
        setRemoteStream(null);
        setPeerCount(0);
      });
    };
    teardownRef.current = teardown;

    const start = async () => {
      void Promise.resolve().then(() => {
        if (disposed) return;
        setPhase("negotiating");
        setError(null);
      });
      try {
        if (
          globalThis.navigator === undefined ||
          !navigator.mediaDevices?.getUserMedia
        ) {
          setError(tRef.current("call.unsupported"));
          setPhase("failed");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video:
            kind === "VIDEO"
              ? { width: { ideal: 1280 }, facingMode: "user" }
              : false,
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMicEnabled(stream.getAudioTracks().every((track) => track.enabled));
        setCameraEnabled(
          kind === "VIDEO" &&
            stream.getVideoTracks().every((track) => track.enabled)
        );

        // TURN credentials are minted server-side; STUN is the safe fallback.
        const iceServers = await resolveIceServers(() => api.iceServers());
        if (disposed) return;
        const pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          let rs = remoteStreamRef.current;
          if (!rs) {
            rs = event.streams[0] ?? new MediaStream();
            remoteStreamRef.current = rs;
          }
          const tracks = event.streams[0]
            ? event.streams[0].getTracks()
            : [event.track];
          for (const track of tracks) {
            if (!rs.getTracks().includes(track)) rs.addTrack(track);
          }
          setRemoteStream(rs);
          setPeerCount(1);
        };

        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          void api
            .callSignal(id, "ICE", { candidate: event.candidate.toJSON() })
            .catch(() => undefined);
        };

        // Reconnect loop (caller drives, callee waits for the re-offer):
        //  - "disconnected" is transient (roaming / NAT rebinding) — show the
        //    reconnecting UI and let ICE recover on its own.
        //  - "failed" means ICE gave up: restartIce + fresh re-offer, up to
        //    MAX_RECONNECT_ATTEMPTS with exponential backoff, then terminal.
        // Signaling stays on the same authenticated REST relay — no replatform.
        const scheduleReoffer = () => {
          const pcNow = pcRef.current;
          if (!pcNow || disposed || endedRef.current) return;
          const attempt = reconnectAttemptsRef.current;
          if (attempt >= MAX_RECONNECT_ATTEMPTS) {
            setError(tRef.current("call.failed"));
            setPhase("failed");
            teardownRef.current();
            return;
          }
          reconnectAttemptsRef.current = attempt + 1;
          setPhase("reconnecting");
          const delayMs = 1000 * 2 ** attempt; // 1 s, 2 s, 4 s
          reconnectTimerRef.current = setTimeout(() => {
            void (async () => {
              const live = pcRef.current;
              if (!live || disposed || endedRef.current) return;
              try {
                live.restartIce();
                const offer = await live.createOffer({ iceRestart: true });
                await live.setLocalDescription(offer);
                await api.callSignal(id, "OFFER", {
                  sdp: offer.sdp,
                  type: offer.type,
                });
              } catch {
                // The restart itself failed — consume the next backoff step.
                scheduleReoffer();
              }
            })();
          }, delayMs);
        };

        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === "connected" ||
            pc.iceConnectionState === "completed"
          ) {
            reconnectAttemptsRef.current = 0;
            setPhase("connected");
          } else if (pc.connectionState === "disconnected") {
            setPhase("reconnecting");
          } else if (pc.connectionState === "failed") {
            // Only the caller re-offers (mirrors the mesh initiator rule) so
            // both sides never re-offer past each other; the callee holds the
            // reconnecting UI until the fresh OFFER arrives.
            if (!isCaller) {
              setPhase("reconnecting");
              return;
            }
            scheduleReoffer();
          }
        };

        if (isCaller) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await api.callSignal(id, "OFFER", {
            sdp: offer.sdp,
            type: offer.type,
          });
        }

        if (disposed) return;
        intervalRef.current = setInterval(() => {
          void poll();
        }, 1000);
        void poll();
      } catch (err) {
        if (disposed) return;
        const denied =
          err instanceof DOMException && err.name === "NotAllowedError";
        setError(
          denied
            ? tRef.current("call.permissionDenied")
            : tRef.current("call.failed")
        );
        setPhase("failed");
        teardownRef.current();
      }
    };

    void start();

    return () => {
      disposed = true;
      teardown();
    };
  }, [active, callId, side, kind, isCaller]);

  const attachRemote = useCallback((el: HTMLVideoElement | null) => {
    remoteElRef.current = el;
    if (el) el.srcObject = remoteStreamRef.current;
  }, []);

  const attachLocal = useCallback((el: HTMLVideoElement | null) => {
    localElRef.current = el;
    if (el) {
      el.muted = true;
      el.srcObject = localStreamRef.current;
    }
  }, []);

  const toggleMic = useCallback(() => {
    const ls = localStreamRef.current;
    if (!ls) return;
    const enabled = !ls.getAudioTracks().every((track) => track.enabled);
    ls.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setMicEnabled(enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const ls = localStreamRef.current;
    if (!ls || kind !== "VIDEO") return;
    const enabled = !ls.getVideoTracks().every((track) => track.enabled);
    ls.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setCameraEnabled(enabled);
  }, [kind]);

  const hangup = useCallback(() => {
    const id = callId;
    if (id) {
      void (async () => {
        await api.callSignal(id, "HANGUP", {}).catch(() => undefined);
        await api.callAction(id, "end").catch(() => undefined);
      })();
    }
    endedRef.current = true;
    teardownRef.current();
    setPhase("ended");
  }, [callId]);

  return {
    state: {
      phase,
      remoteStream,
      localStream,
      micEnabled,
      cameraEnabled,
      error,
      durationSec,
      peerCount,
    },
    attachRemote,
    attachLocal,
    toggleMic,
    toggleCamera,
    hangup,
  };
}
