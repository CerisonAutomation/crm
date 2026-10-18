"use client";
/**
 * Global call store — the single source of truth for the app-wide calling
 * experience. Kept deliberately separate from `@/lib/store` (navigation) so the
 * call lifecycle can be driven from anywhere in the shell.
 *
 * It holds only UI/lifecycle metadata: the signaling id, the case context and
 * the current phase. Media and peer connection live in `useP2PCall`.
 */
import { create } from "zustand";

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

type CallState = {
  phase: CallPhase;
  callId: string | null;
  caseId: string | null;
  caseReference: string | null;
  kind: "AUDIO" | "VIDEO";
  side: "CLIENT" | "STAFF" | null;
  /** True when this side placed the call. Latched at `start()` so the WebRTC
   *  offer/answer role stays correct after the phase moves on from
   *  "outgoing"/"incoming" to "connecting"/"active"/"ended". */
  initiatedByUs: boolean;
  counterpartyName: string | null;
  notice: string | null; // short human note shown in the overlay (e.g. "Call declined")
  busy: boolean;
  minimized: boolean;
  start: (
    callId: string,
    caseId: string,
    caseReference: string,
    kind: "AUDIO" | "VIDEO",
    side: "CLIENT" | "STAFF",
    counterpartyName: string | null,
    phase?: "incoming" | "outgoing",
  ) => void;
  setPhase: (phase: CallPhase) => void;
  setNotice: (notice: string | null) => void;
  setBusy: (busy: boolean) => void;
  setMinimized: (minimized: boolean) => void;
  reset: () => void;
};

const INITIAL = {
  phase: "idle" as CallPhase,
  callId: null,
  caseId: null,
  caseReference: null,
  kind: "AUDIO" as const,
  side: null,
  initiatedByUs: false,
  counterpartyName: null,
  notice: null,
  busy: false,
  minimized: false,
};

export const useCallStore = create<CallState>((set) => ({
  ...INITIAL,
  start: (callId, caseId, caseReference, kind, side, counterpartyName, phase = "incoming") =>
    set({
      callId,
      caseId,
      caseReference,
      kind,
      side,
      initiatedByUs: phase === "outgoing",
      counterpartyName,
      phase,
      notice: null,
      busy: false,
      minimized: false,
    }),
  setPhase: (phase) => set({ phase }),
  setNotice: (notice) => set({ notice }),
  setBusy: (busy) => set({ busy }),
  setMinimized: (minimized) => set({ minimized }),
  reset: () => set({ ...INITIAL }),
}));
