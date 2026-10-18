"use client";
/**
 * CallCenter — the app-wide calling surface. Mounted once in the shell so an
 * incoming call is visible from anywhere for the two parties on the case.
 *
 * It owns two experiences:
 *  - the global incoming-call discovery + banner (idle short-poll), and
 *  - the in-call overlay (video stage / audio disc, status, mic/camera/hang-up)
 *    built on `useP2PCall`.
 *
 * Auditors are read-only oversight: they never poll, ring or see an overlay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n, LOCALES, type Locale } from "@/lib/i18n";
import { useCallStore } from "./call-store";
import { useDebouncedCallback } from "@/hooks";
import { useP2PCall } from "@/hooks/use-p2p-call";
import { FocusTrap } from "@/components/brand/focus-trap";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Captions,
  Copy,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
import { useSpeechToText } from "@/hooks/use-speech-to-text";
import { translateInBrowser } from "@/lib/ai/browser-translate";
import { cn } from "@/lib/utils";

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p.charAt(0).toUpperCase()).join("");
  return initials || "?";
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallCenter() {
  const { t, locale } = useI18n();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const session = useApp((s) => s.session);
  const role = session?.role ?? null;
  const isAuditor = role === "AUDITOR";
  const mySide: "CLIENT" | "STAFF" = role === "CLIENT" ? "CLIENT" : "STAFF";

  const phase = useCallStore((s) => s.phase);
  const callId = useCallStore((s) => s.callId);
  const kind = useCallStore((s) => s.kind);
  const side = useCallStore((s) => s.side);
  const initiatedByUs = useCallStore((s) => s.initiatedByUs);
  const caseReference = useCallStore((s) => s.caseReference);
  const counterpartyName = useCallStore((s) => s.counterpartyName);
  const notice = useCallStore((s) => s.notice);
  const minimized = useCallStore((s) => s.minimized);
  const setPhase = useCallStore((s) => s.setPhase);
  const setNotice = useCallStore((s) => s.setNotice);
  const setMinimized = useCallStore((s) => s.setMinimized);
  const reset = useCallStore((s) => s.reset);

  const [answering, setAnswering] = useState(false);

  // ── Transcription + recording (enterprise call options) ──
  const stt = useSpeechToText(locale);
  const sttRef = useRef(stt);
  useEffect(() => {
    sttRef.current = stt;
  });
  const autoStartedRef = useRef(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptPref, setTranscriptPref] = useState(false);
  const [recordingRequested, setRecordingRequested] = useState(false);
  // Dual recording consent (1:1 trust): the saved transcript stays hidden until
  // BOTH sides ack. Copy is inline English until the next i18n pass adds keys.
  const [consentComplete, setConsentComplete] = useState(false);
  const [consentMine, setConsentMine] = useState(false);

  // Live subtitles — translated on THIS device (browser model), never on a server.
  const [subtitleLang, setSubtitleLang] = useState<Locale>(locale);
  const subtitleLangRef = useRef(subtitleLang);
  useEffect(() => {
    subtitleLangRef.current = subtitleLang;
  });
  const [subs, setSubs] = useState<
    Array<{ who: "me" | "peer"; text: string; translated?: boolean }>
  >([]);
  const sentRef = useRef(0);

  // Load the caller's call preferences once per session.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .notifications()
      .then((res) => {
        if (!alive || !res.prefs?.callPrefs) return;
        try {
          const cp = JSON.parse(res.prefs.callPrefs) as {
            transcription?: boolean;
            recording?: boolean;
          };
          setTranscriptPref(cp.transcription === true);
          setRecordingRequested(cp.recording === true);
        } catch {
          /* malformed stored JSON — keep defaults */
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session]);

  // Begin a fresh transcript + subtitles for each call.
  useEffect(() => {
    autoStartedRef.current = false;
    sentRef.current = 0;
    sttRef.current.reset();
    setSubs([]);
    setConsentComplete(false);
    setConsentMine(false);
  }, [callId]);

  // Push each new final speech segment on-screen and relay the raw line to the
  // peer, who translates it on their own device.
  useEffect(() => {
    const full = stt.transcript;
    if (full.length <= sentRef.current) return;
    const delta = full.slice(sentRef.current).trim();
    sentRef.current = full.length;
    if (!delta) return;
    setSubs((s) => [...s.slice(-4), { who: "me", text: delta }]);
    if (callId)
      void api
        .callSignal(callId, "SUBTITLE", { text: delta, lang: locale })
        .catch(() => undefined);
  }, [stt.transcript, callId, locale]);

  // Autosave the live transcript (debounced) as it grows.
  const saveTranscript = useDebouncedCallback(
    (id: string, transcript: string) => {
      void api.callTranscriptSave(id, { transcript }).catch(() => undefined);
    },
    1500
  );

  useEffect(() => {
    // Never persist a word before dual consent — the server rejects early
    // writes too; this gate just avoids spamming it.
    if (!callId || !stt.transcript || !consentComplete) return;
    saveTranscript(callId, stt.transcript);
    return () => saveTranscript.cancel();
  }, [callId, stt.transcript, consentComplete, saveTranscript]);

  // ── Incoming-call discovery — idle only, every 4 s (and immediately on mount). ──
  useEffect(() => {
    if (!session || isAuditor) return;
    let disposed = false;
    const check = async () => {
      if (disposed) return;
      if (useCallStore.getState().phase !== "idle") return;
      try {
        const res = await api.calls({ active: true });
        if (disposed) return;
        const store = useCallStore.getState();
        if (store.phase !== "idle") return;
        const incoming = res.calls.find((call) => call.callerRole !== mySide);
        if (!incoming) return;
        const name = incoming.counterparty?.name ?? null;
        store.start(
          incoming.id,
          incoming.caseId,
          incoming.caseReference,
          incoming.kind,
          mySide,
          name
        );
        toast({
          title: tRef.current("call.incoming", {
            name: name ?? tRef.current("call.counterpart"),
          }),
        });
      } catch {
        /* non-critical — the next tick retries */
      }
    };
    void Promise.resolve().then(check);
    const timer = setInterval(() => {
      void check();
    }, 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [session, isAuditor, mySide]);

  // Who initiated: "outgoing" always means we are the caller, "incoming" the peer.
  // Once the phase advances to connecting/active/ended the store's latch is the
  // only record of it, which is why that flag lives in the store rather than in
  // a ref — a ref read during render is neither reactive nor tear-safe.
  const isCaller =
    phase === "outgoing" ? true : phase === "incoming" ? false : initiatedByUs;

  const handleEnded = useCallback(() => {
    setNotice(tRef.current("call.endedByPeer"));
    setPhase("ended");
  }, [setNotice, setPhase]);

  // Peer speech arrives as raw text — translate it on OUR device for display.
  const handlePeerSubtitle = useCallback(
    (line: { text: string; lang: string }) => {
      setSubs((s) => [...s.slice(-4), { who: "peer", text: line.text }]);
      void translateInBrowser(line.text, {
        source: line.lang || "en",
        target: subtitleLangRef.current,
      })
        .then((res) => {
          setSubs((s) => {
            const copy = [...s];
            const last = copy[copy.length - 1];
            if (last?.who === "peer")
              copy[copy.length - 1] = {
                who: "peer",
                text: res.text,
                translated: res.translated,
              };
            return copy.slice(-5);
          });
        })
        .catch(() => undefined);
    },
    []
  );

  const callActive =
    phase === "outgoing" || phase === "connecting" || phase === "active";
  const { state, attachRemote, attachLocal, toggleMic, toggleCamera, hangup } =
    useP2PCall({
      callId,
      kind,
      side,
      isCaller,
      active: callActive,
      onEnded: handleEnded,
      onSubtitle: handlePeerSubtitle,
    });

  // Reflect a live peer connection in the store phase.
  useEffect(() => {
    if (state.phase !== "connected") return;
    const current = useCallStore.getState().phase;
    if (current === "outgoing" || current === "connecting") {
      void Promise.resolve().then(() =>
        useCallStore.getState().setPhase("active")
      );
    }
  }, [state.phase]);

  // Auto-start transcription once connected, when the user opted in.
  useEffect(() => {
    if (autoStartedRef.current || !transcriptPref || !stt.supported) return;
    if (state.phase !== "connected") return;
    autoStartedRef.current = true;
    stt.start();
    setTranscriptOpen(true);
  }, [transcriptPref, state.phase, stt]);

  // Hold the "ended" state briefly, then release the store.
  useEffect(() => {
    if (phase !== "ended") return;
    const timer = setTimeout(() => useCallStore.getState().reset(), 2500);
    return () => clearTimeout(timer);
  }, [phase]);

  const overlayOpen =
    phase === "outgoing" ||
    phase === "connecting" ||
    phase === "active" ||
    phase === "ended";
  // CallCenter is shell-mounted, so nothing else would ever stop the
  // transcription mic — release it as soon as the overlay closes.
  useEffect(() => {
    if (!overlayOpen) stt.stop();
  }, [overlayOpen, stt.stop]);

  // Dual-consent status (5 s poll while the overlay is live): the transcript
  // below stays hidden until BOTH sides ack recording consent.
  useEffect(() => {
    if (!callId || !overlayOpen) return;
    let disposed = false;
    const sync = async () => {
      try {
        const res = await api.callGet(callId);
        if (disposed) return;
        setConsentComplete(res.consentComplete);
        setConsentMine(res.consents.some((c) => c.role === mySide));
        setRecordingRequested(res.recordingRequested);
      } catch {
        /* transient — the next tick retries */
      }
    };
    void sync();
    const timer = setInterval(() => {
      void sync();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [callId, overlayOpen, mySide]);

  const acknowledgeConsent = useCallback(async () => {
    if (!callId) return;
    try {
      const res = await api.callTranscriptSave(callId, { consentGiven: true });
      setConsentComplete(res.consentComplete);
      setConsentMine(res.consents.some((c) => c.role === mySide));
    } catch {
      /* surfaced on the next poll — never blocks the call */
    }
  }, [callId, mySide]);

  const accept = useCallback(async () => {
    if (!callId) return;
    setAnswering(true);
    try {
      await api.callAction(callId, "answer");
      setPhase("connecting");
    } catch (e) {
      toast({
        title: tRef.current("call.failed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
      reset();
    } finally {
      setAnswering(false);
    }
  }, [callId, setPhase, reset]);

  const decline = useCallback(async () => {
    if (!callId) return;
    await api.callAction(callId, "decline").catch(() => undefined);
    reset();
  }, [callId, reset]);

  const end = useCallback(() => {
    hangup();
    setPhase("ended");
  }, [hangup, setPhase]);

  // Accessibility: the overlay behaves as a modal dialog — it takes focus when it
  // opens (and Esc ends the call). Declared before the early return so the hook
  // order is stable.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (overlayOpen && !minimized) overlayRef.current?.focus();
  }, [overlayOpen, minimized]);

  if (!session || isAuditor) return null;

  const isEnded = phase === "ended";
  const isOverlay =
    phase === "outgoing" ||
    phase === "connecting" ||
    phase === "active" ||
    isEnded;

  const statusText =
    state.phase === "failed"
      ? state.error ?? t("call.failed")
      : isEnded
      ? notice
        ? `${t("call.ended")} · ${notice}`
        : t("call.ended")
      : state.phase === "connected"
      ? `${t("call.connected")} · ${formatDuration(state.durationSec)}`
      : phase === "outgoing"
      ? t("call.ringing")
      : t("call.connecting");

  return (
    <>
      {/* ── Incoming call banner ── */}
      {phase === "incoming" && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label={t("call.incoming", {
            name: counterpartyName ?? t("call.counterpart"),
          })}
          className="fixed bottom-4 right-4 z-[60] w-full max-w-sm rounded-md border border-gold/40 bg-card p-4 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-ink">
              {kind === "VIDEO" ? (
                <Video className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Phone className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-editorial text-base text-cobble-ink">
                {t("call.incoming", {
                  name: counterpartyName ?? t("call.counterpart"),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {caseReference ?? ""} ·{" "}
                {kind === "VIDEO" ? t("call.video") : t("call.audio")}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              onClick={() => void accept()}
              disabled={answering}
              className="flex-1 bg-gold text-cobble-ink hover:bg-gold/90"
            >
              {answering ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Phone className="h-4 w-4" aria-hidden="true" />
              )}
              {t("call.accept")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void decline()}
              className="flex-1 border-coral/50 text-danger-ink hover:bg-coral/10"
            >
              <PhoneOff className="h-4 w-4" aria-hidden="true" />
              {t("call.decline")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Minimised in-call bar ── */}
      {isOverlay && minimized && (
        <div className="fixed bottom-4 right-4 z-[70] flex items-center gap-3 rounded-full border border-gold/40 bg-cobble px-4 py-2 text-[#F5F1EA] shadow-lg">
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="flex items-center gap-2 text-sm"
          >
            <Phone className="h-4 w-4 text-gold-ink" aria-hidden="true" />
            <span className="font-editorial">
              {counterpartyName ?? t("call.counterpart")}
            </span>
            <span className="tabular-nums text-[#B9C4CE]">
              {formatDuration(state.durationSec)}
            </span>
          </button>
          <Button
            type="button"
            size="icon"
            onClick={end}
            aria-label={t("call.end")}
            title={t("call.end")}
            className="h-11 w-11 rounded-full bg-coral text-cobble-ink hover:bg-coral/90"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* ── Full in-call overlay ── */}
      {isOverlay && !minimized && (
        <div
          ref={overlayRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={
            counterpartyName
              ? `${t("call.counterpart")} ${counterpartyName}`
              : t("call.counterpart")
          }
          className="fixed inset-0 z-[70] flex flex-col bg-cobble/95 text-[#F5F1EA] outline-none"
        >
          <FocusTrap onEscape={end}>
            <header className="flex items-center justify-between gap-3 border-b border-gold/20 px-5 py-3">
              <div className="min-w-0">
                <p className="font-editorial truncate text-lg">
                  {counterpartyName
                    ? `${t("call.counterpart")} ${counterpartyName}`
                    : t("call.counterpart")}
                </p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-gold-ink">
                  {caseReference ?? ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className="inline-flex items-center gap-1 rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-gold-ink"
                  title={t("call.p2pNote")}
                >
                  {t("call.p2pNote")}
                </span>
                <label className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#B9C4CE] sm:flex">
                  {t("call.subtitleLang")}
                  <select
                    value={subtitleLang}
                    onChange={(e) => setSubtitleLang(e.target.value as Locale)}
                    aria-label={t("call.subtitleLang")}
                    className="rounded border border-gold/40 bg-transparent px-1 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#F5F1EA]"
                  >
                    {LOCALES.map((l) => (
                      <option
                        key={l.code}
                        value={l.code}
                        className="text-cobble-ink"
                      >
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  className="text-[11px] uppercase tracking-[0.14em] text-[#B9C4CE] hover:text-[#F5F1EA]"
                >
                  {t("call.minimize")}
                </button>
              </div>
            </header>

            {kind === "VIDEO" ? (
              <div className="relative flex-1 overflow-hidden bg-cobble">
                <video
                  ref={attachRemote}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />
                <video
                  ref={attachLocal}
                  autoPlay
                  playsInline
                  muted
                  className="absolute bottom-4 right-4 h-28 w-40 rounded border border-gold/40 object-cover"
                />
              </div>
            ) : (
              <div className="relative flex flex-1 flex-col items-center justify-center gap-4">
                <div className="flex h-28 w-28 items-center justify-center rounded-full border border-gold/40 bg-gold/15 font-editorial text-3xl text-gold-ink">
                  {initialsOf(counterpartyName)}
                </div>
                {/* The remote element stays mounted so audio plays with no video track. */}
                <video
                  ref={attachRemote}
                  autoPlay
                  playsInline
                  className="hidden"
                />
                <video
                  ref={attachLocal}
                  autoPlay
                  playsInline
                  muted
                  className="hidden"
                />
              </div>
            )}

            {/* Live translated subtitles — on-device, per viewer */}
            {(stt.listening || subs.length > 0) && (
              <div className="border-t border-gold/20 bg-black/35 px-5 py-2">
                {subs.length === 0 ? (
                  <p className="text-center text-[11px] text-[#B9C4CE]">
                    {t("call.subtitleEmpty")}
                  </p>
                ) : (
                  <div
                    className="space-y-1"
                    role="log"
                    aria-live="polite"
                    aria-atomic="false"
                  >
                    {subs.slice(-3).map((line, i) => (
                      <p
                        key={i}
                        className={cn(
                          "text-sm leading-snug",
                          line.who === "me" ? "text-[#E8E2D6]" : "text-gold-ink"
                        )}
                      >
                        <span className="mr-2 text-[10px] uppercase tracking-[0.14em] text-[#8B9EB2]">
                          {line.who === "me"
                            ? t("call.you")
                            : counterpartyName ?? t("call.counterpart")}
                        </span>
                        {line.text}
                        {line.translated === false && (
                          <span className="ml-2 text-[10px] text-[#8B9EB2]">
                            ({t("call.subtitleOriginal")})
                          </span>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Live transcript (speech-to-text) + recording-consent flag */}
            {transcriptOpen && (
              <div className="border-t border-gold/20 bg-cobble/60 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-ink">
                    {t("call.transcript")}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!callId) return;
                        void api
                          .callTranscriptSave(callId, {
                            recordingRequested: !recordingRequested,
                          })
                          .then((res) =>
                            setRecordingRequested(res.recordingRequested)
                          )
                          .catch(() => undefined);
                      }}
                      className={cn(
                        "rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                        recordingRequested
                          ? "border-coral/60 text-[#e6a3a1]"
                          : "border-gold/40 text-[#B9C4CE] hover:text-[#F5F1EA]"
                      )}
                    >
                      {recordingRequested
                        ? t("call.recordRequested")
                        : t("call.recordRequest")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(stt.transcript)
                          .then(() =>
                            toast({ title: t("call.transcriptCopied") })
                          )
                          .catch(() => undefined);
                      }}
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#B9C4CE] hover:text-[#F5F1EA]"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />{" "}
                      {t("call.transcriptCopy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTranscriptOpen(false)}
                      className="text-[10px] uppercase tracking-[0.14em] text-[#B9C4CE] hover:text-[#F5F1EA]"
                    >
                      {t("common.close")}
                    </button>
                  </div>
                </div>
                {!consentComplete ? (
                  <div className="mt-2 rounded border border-gold/40 bg-gold/10 px-3 py-2">
                    <p className="text-[13px] leading-relaxed text-[#E8E2D6]">
                      The transcript stays hidden until both sides consent to
                      transcription.
                      {consentMine
                        ? " You consented — waiting for the other party."
                        : " Acknowledge below to reveal it."}
                    </p>
                    {!consentMine && callId && (
                      <button
                        type="button"
                        onClick={() => void acknowledgeConsent()}
                        className="mt-2 rounded border border-gold/50 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-gold-ink hover:bg-gold/15"
                      >
                        I consent to transcription
                      </button>
                    )}
                  </div>
                ) : (
                  <p
                    className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap text-sm text-[#E8E2D6]"
                    role="log"
                    aria-live="polite"
                    aria-atomic="false"
                  >
                    {stt.transcript || stt.interim || t("call.transcriptEmpty")}
                  </p>
                )}
                {!stt.supported && (
                  <p className="mt-1 text-[11px] text-[#B9C4CE]">
                    {t("call.transcribeUnsupported")}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col items-center gap-3 border-t border-gold/20 px-5 py-4">
              <p className="text-sm text-[#B9C4CE]" aria-live="polite">
                {statusText}
              </p>
              <div className="flex items-center gap-3">
                {stt.supported && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      if (stt.listening) stt.stop();
                      else {
                        stt.start();
                        setTranscriptOpen(true);
                      }
                    }}
                    aria-label={
                      stt.listening
                        ? t("call.transcribeStop")
                        : t("call.transcribe")
                    }
                    title={
                      stt.listening
                        ? t("call.transcribeStop")
                        : t("call.transcribe")
                    }
                    className={cn(
                      "h-11 w-11 rounded-full border-gold/40 bg-transparent text-[#F5F1EA] hover:bg-gold/15",
                      stt.listening && "bg-gold/15 text-gold-ink"
                    )}
                  >
                    <Captions className="h-5 w-5" aria-hidden="true" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={toggleMic}
                  aria-label={
                    state.micEnabled ? t("call.mute") : t("call.unmute")
                  }
                  title={state.micEnabled ? t("call.mute") : t("call.unmute")}
                  className="h-11 w-11 rounded-full border-gold/40 bg-transparent text-[#F5F1EA] hover:bg-gold/15"
                >
                  {state.micEnabled ? (
                    <Mic className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <MicOff className="h-5 w-5" aria-hidden="true" />
                  )}
                </Button>
                {kind === "VIDEO" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={toggleCamera}
                    aria-label={
                      state.cameraEnabled
                        ? t("call.cameraOff")
                        : t("call.cameraOn")
                    }
                    title={
                      state.cameraEnabled
                        ? t("call.cameraOff")
                        : t("call.cameraOn")
                    }
                    className="h-11 w-11 rounded-full border-gold/40 bg-transparent text-[#F5F1EA] hover:bg-gold/15"
                  >
                    {state.cameraEnabled ? (
                      <VideoOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Video className="h-5 w-5" aria-hidden="true" />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  onClick={end}
                  aria-label={t("call.end")}
                  title={t("call.end")}
                  className="h-11 w-11 rounded-full bg-coral text-cobble-ink hover:bg-coral/90"
                >
                  <PhoneOff className="h-5 w-5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </FocusTrap>
        </div>
      )}
    </>
  );
}
