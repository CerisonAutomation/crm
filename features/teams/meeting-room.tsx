"use client";
/**
 * MeetingRoom — the full-screen multi-party meeting surface.
 *
 * Media rides the `useMeshCall` peer-to-peer mesh; the server only relays
 * signaling. This component adds the real, host-only capture side: it mixes the
 * local stream and every peer stream through one `AudioContext` into a single
 * destination and records that with `MediaRecorder`, storing the bytes in the
 * vault via the API. Transcription is an explicit, separate, on-device step
 * reusing the shared `transcribeAudio` pipeline — a failed model run is reported
 * plainly and the audio is kept; no transcript text is ever invented.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type MeetingRow } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/brand/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useMeshCall, type MeshPeer } from "@/hooks/use-mesh-call";
import {
  blobToBase64,
  transcribeAudio,
  useLiveCaptions,
} from "@/features/teams/voice-note";
import {
  Camera,
  CameraOff,
  Circle,
  FileText,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Square,
  X,
} from "lucide-react";

type AudioContextCtor = typeof AudioContext;

function createAudioContext(): AudioContext | null {
  if (globalThis.window === undefined) return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function MeetingRoom({
  meeting,
  onClose,
}: {
  meeting: MeetingRow;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isVideo = meeting.kind === "VIDEO";
  const isHost = meeting.myRole === "HOST";

  const {
    state,
    attachLocal,
    attachPeerVideo,
    toggleMic,
    toggleCamera,
    leave,
    endForEveryone,
  } = useMeshCall({
    meetingId: meeting.id,
    kind: isVideo ? "VIDEO" : "AUDIO",
    active: true,
    isHost,
    onEnded: () => {
      toast({ title: t("meeting.ended") });
      onClose();
    },
  });

  const [endOpen, setEndOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // ── push-to-talk (hold Space): momentarily unmute a muted mic ──
  // Wires the meeting-room mic into the same hold-to-speak gesture family as
  // the shell's PushToTalk control: holding Space unmutes a muted mic and
  // releasing restores the mute. Typing in inputs/textareas is never hijacked,
  // and a window blur restores the mute so the mic can never stick hot.
  const micEnabledRef = useRef(state.micEnabled);
  useEffect(() => {
    micEnabledRef.current = state.micEnabled;
  });
  const pttRestoresMuteRef = useRef(false);
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null;
      const tag = node?.tagName?.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        node?.isContentEditable === true
      );
    };
    const restore = () => {
      if (pttRestoresMuteRef.current) {
        pttRestoresMuteRef.current = false;
        toggleMic();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey)
        return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      if (!pttRestoresMuteRef.current && !micEnabledRef.current) {
        toggleMic();
        pttRestoresMuteRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      restore();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", restore);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", restore);
    };
  }, [toggleMic]);

  // ── recording (host only) ──
  // Counterparty ack: every participant stamps CONSENT before a byte is stored.
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentMissing, setConsentMissing] = useState<number | null>(null);
  const refreshConsent = useCallback(() => {
    void api
      .meeting(meeting.id)
      .then((res) => setConsentMissing(res.consent.missing))
      .catch(() => undefined);
  }, [meeting.id]);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [savingRecording, setSavingRecording] = useState(false);
  const [draft, setDraft] = useState<{
    base64: string;
    mime: string;
    durationMs: number;
  } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const recStartRef = useRef(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── transcript (host only) ──
  const captions = useLiveCaptions();
  const [transcriptText, setTranscriptText] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sttUnavailable, setSttUnavailable] = useState(false);
  const [savingTranscript, setSavingTranscript] = useState(false);

  const stopMixer = useCallback(() => {
    for (const node of sourcesRef.current.values()) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    sourcesRef.current.clear();
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    destRef.current = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }, []);

  // Keep the mixer fed while recording: connect the local stream and every peer
  // stream that has not been wired in yet (peers may join mid-recording).
  useEffect(() => {
    if (!recording) return;
    const ctx = audioCtxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest) return;
    const ensure = (key: string, stream: MediaStream | null) => {
      if (!stream || sourcesRef.current.has(key)) return;
      try {
        const node = ctx.createMediaStreamSource(stream);
        node.connect(dest);
        sourcesRef.current.set(key, node);
      } catch {
        /* stream already ended */
      }
    };
    ensure("self", state.localStream);
    for (const p of state.peers) ensure(p.userId, p.stream);
  }, [recording, state.localStream, state.peers]);

  // Unmount safety — never leave the mic hot, the mixer open or the recorder running.
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      recorderRef.current = null;
      if (recTimerRef.current !== null) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      stopMixer();
    },
    [stopMixer]
  );

  const storeRecording = useCallback(
    async (p: { base64: string; mime: string; durationMs: number }) => {
      setSavingRecording(true);
      try {
        const res = await api.meetingStoreRecording(meeting.id, {
          audioBase64: p.base64,
          mime: p.mime,
          durationMs: p.durationMs,
          // Local dialog ack AND every counterparty's ack (server enforces both).
          consentGiven: true,
        });
        refreshConsent();
        toast({
          title: t("meeting.recordingSaved"),
          description: `${Math.round(res.bytes / 1024)} KB`,
        });
      } catch (e) {
        toast({
          title: t("meeting.recordingFailed"),
          description: e instanceof Error ? e.message : undefined,
          variant: "destructive",
        });
      } finally {
        setSavingRecording(false);
      }
    },
    [meeting.id, refreshConsent, t]
  );

  const startRecording = useCallback(() => {
    if (recording || recorderRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      toast({ title: t("meeting.recordingFailed"), variant: "destructive" });
      return;
    }
    const ctx = createAudioContext();
    if (!ctx) {
      toast({ title: t("meeting.recordingFailed"), variant: "destructive" });
      return;
    }
    const dest = ctx.createMediaStreamDestination();
    audioCtxRef.current = ctx;
    destRef.current = dest;
    sourcesRef.current = new Map();

    const connect = (key: string, stream: MediaStream | null) => {
      if (!stream) return;
      try {
        const node = ctx.createMediaStreamSource(stream);
        node.connect(dest);
        sourcesRef.current.set(key, node);
      } catch {
        /* ignore an ended stream */
      }
    };
    connect("self", state.localStream);
    for (const p of state.peers) connect(p.userId, p.stream);

    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(
        dest.stream,
        mime ? { mimeType: mime } : undefined
      );
    } catch {
      stopMixer();
      toast({ title: t("meeting.recordingFailed"), variant: "destructive" });
      return;
    }
    mimeRef.current = rec.mimeType || mime || "audio/webm";
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = rec;
    recStartRef.current = Date.now();
    setRecordingMs(0);
    recTimerRef.current = setInterval(
      () => setRecordingMs(Date.now() - recStartRef.current),
      1000
    );
    try {
      rec.start(1000);
    } catch {
      recorderRef.current = null;
      stopMixer();
      toast({ title: t("meeting.recordingFailed"), variant: "destructive" });
      return;
    }
    setRecording(true);
  }, [recording, state.localStream, state.peers, stopMixer, t]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    const durationMs = Date.now() - recStartRef.current;
    const mime = mimeRef.current;
    if (recTimerRef.current !== null) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    setRecording(false);

    const result = await new Promise<{ base64: string; bytes: number } | null>(
      (resolve) => {
        let settled = false;
        const finish = (value: { base64: string; bytes: number } | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mime });
          chunksRef.current = [];
          void blobToBase64(blob)
            .then((base64) => finish({ base64, bytes: blob.size }))
            .catch(() => finish(null));
        };
        try {
          rec.stop();
        } catch {
          finish(null);
        }
      }
    );

    recorderRef.current = null;
    stopMixer();
    setRecordingMs(0);
    if (!result) {
      toast({ title: t("meeting.recordingFailed"), variant: "destructive" });
      return;
    }
    const next = { base64: result.base64, mime, durationMs };
    setDraft(next);
    await storeRecording(next);
  }, [stopMixer, storeRecording, t]);

  const handleRecord = useCallback(() => {
    if (recording) {
      void stopRecording();
      return;
    }
    if (!consentGiven) {
      refreshConsent();
      setConsentOpen(true);
      return;
    }
    startRecording();
  }, [consentGiven, recording, refreshConsent, startRecording, stopRecording]);

  const handleLeave = useCallback(() => {
    if (recording) void stopRecording();
    void leave().finally(onClose);
    onClose();
  }, [leave, onClose, recording, stopRecording]);

  const handleEndAll = useCallback(() => {
    if (recording) void stopRecording();
    void endForEveryone().finally(onClose);
    onClose();
  }, [endForEveryone, onClose, recording, stopRecording]);

  const appendTranscript = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscriptText((prev) =>
      prev.trim() ? `${prev.trim()}\n\n${clean}` : clean
    );
  }, []);

  const handleCaptions = useCallback(() => {
    if (captions.listening) {
      captions.stop();
      appendTranscript(captions.text);
    } else {
      captions.start();
    }
  }, [appendTranscript, captions]);

  const handleTranscribe = useCallback(async () => {
    if (!draft) return;
    setTranscribing(true);
    setProgress(0);
    setSttUnavailable(false);
    const out = await transcribeAudio(
      { base64: draft.base64, mime: draft.mime },
      (p) => setProgress(p.progress)
    );
    setTranscribing(false);
    setProgress(null);
    const text = out?.text.trim() ?? "";
    if (!text) {
      // Honest failure — the recording stays available, no text is invented.
      setSttUnavailable(true);
      return;
    }
    appendTranscript(text);
  }, [appendTranscript, draft]);

  const handleSaveTranscript = useCallback(async () => {
    if (!transcriptText.trim()) return;
    setSavingTranscript(true);
    try {
      await api.meetingSaveTranscript(meeting.id, transcriptText.trim());
      toast({ title: t("meeting.transcriptSaved") });
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSavingTranscript(false);
    }
  }, [meeting.id, t, transcriptText]);

  const participantCount = state.participantCount;
  const gridCols =
    participantCount <= 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2";

  const connectionLabel = (conn: MeshPeer["connection"]): string => {
    switch (conn) {
      case "new":
      case "connecting":
        return t("meeting.joining");
      case "disconnected":
        return t("meeting.reconnecting");
      case "failed":
      case "closed":
        return t("meeting.connectionFailed");
      default:
        return "";
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-cobble/95 text-[#F5F1EA]">
      {/* ── header ── */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
            {t("meeting.title")}
          </p>
          <h1 className="truncate font-editorial text-lg">{meeting.title}</h1>
        </div>
        <span className="hidden text-xs text-white/70 sm:inline">
          {t("meeting.withCount", { n: participantCount })}
        </span>
        <span className="rounded border border-white/15 px-2 py-0.5 font-mono text-xs tabular-nums">
          {formatClock(state.durationSec)}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-limestone-ink"
          title={t("meeting.p2pNote")}
        >
          {t("meeting.p2pNote")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("meeting.leave")}
          title={t("meeting.leave")}
          onClick={handleLeave}
          className="text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* ── stage ── */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
          {state.phase === "joining" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/70">
              <Loader2
                className="h-6 w-6 animate-spin text-gold-ink"
                aria-hidden="true"
              />
              <p className="text-sm">{t("meeting.joining")}</p>
            </div>
          )}

          {state.phase === "failed" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="font-editorial text-lg">
                {state.error ?? t("meeting.connectionFailed")}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleLeave}
                className="border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]"
              >
                {t("meeting.leave")}
              </Button>
            </div>
          )}

          {(state.phase === "connected" ||
            state.phase === "reconnecting" ||
            state.phase === "ended") && (
            <>
              <div className={cn("grid gap-3", gridCols)}>
                {/* local tile */}
                <div className="relative overflow-hidden rounded-md border border-white/10 bg-black/30">
                  <div className="aspect-video w-full">
                    {isVideo ? (
                      <video
                        ref={(el) => {
                          attachLocal(el);
                        }}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-lg font-semibold text-limestone-ink">
                          {initials(t("meeting.you"))}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-1.5 text-[11px]">
                    <span className="truncate font-medium">
                      {t("meeting.you")}
                    </span>
                    <span
                      className="flex items-center gap-1.5"
                      aria-hidden="true"
                    >
                      {!state.micEnabled && (
                        <MicOff className="h-3.5 w-3.5 text-coral-ink" />
                      )}
                      {isVideo && !state.cameraEnabled && (
                        <CameraOff className="h-3.5 w-3.5 text-coral-ink" />
                      )}
                    </span>
                  </div>
                </div>

                {/* remote tiles */}
                {state.peers.map((p) => {
                  const label = connectionLabel(p.connection);
                  return (
                    <div
                      key={p.userId}
                      className="relative overflow-hidden rounded-md border border-white/10 bg-black/30"
                    >
                      <div className="aspect-video w-full">
                        {isVideo ? (
                          <video
                            ref={(el) => {
                              attachPeerVideo(p.userId, el);
                            }}
                            autoPlay
                            playsInline
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-lg font-semibold text-limestone-ink">
                              {initials(p.name)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-1.5 text-[11px]">
                        <span className="truncate font-medium">{p.name}</span>
                        <span
                          className="flex items-center gap-1.5"
                          aria-hidden="true"
                        >
                          {!p.micOn && (
                            <MicOff className="h-3.5 w-3.5 text-coral-ink" />
                          )}
                          {isVideo && !p.cameraOn && (
                            <CameraOff className="h-3.5 w-3.5 text-coral-ink" />
                          )}
                        </span>
                      </div>
                      {label && (
                        <span className="absolute left-2 top-2 rounded border border-amber-brand/50 bg-amber-brand/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-limestone-ink">
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-center text-[11px] text-white/50">
                {t("meeting.maxParticipants", { n: meeting.maxParticipants })}
              </p>
            </>
          )}
        </main>

        {/* ── transcript panel (host only) ── */}
        {isHost && panelOpen && (
          <aside className="flex min-h-0 w-full flex-col border-t border-white/10 md:w-96 md:border-l md:border-t-0">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <h2 className="font-editorial text-base">
                {t("meeting.transcript")}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("common.close")}
                onClick={() => setPanelOpen(false)}
                className="text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {/* live captions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">
                    {t("meeting.liveCaptions")}
                  </span>
                  {captions.supported && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCaptions}
                      className="border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]"
                    >
                      {captions.listening ? (
                        <Square className="mr-1.5 h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Mic className="mr-1.5 h-3 w-3" aria-hidden="true" />
                      )}
                      {captions.listening
                        ? t("team.stop")
                        : t("meeting.record")}
                    </Button>
                  )}
                </div>
                {!captions.supported && (
                  <p className="text-[11px] leading-relaxed text-white/60">
                    {t("team.sttListenerUnsupported")}
                  </p>
                )}
                {captions.supported && captions.listening && (
                  <p className="min-h-[2.5rem] rounded border border-white/10 bg-black/20 p-2 text-[13px] leading-relaxed text-white/80">
                    {captions.text || "…"}
                  </p>
                )}
              </div>

              {/* transcribe the recording */}
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!draft || transcribing}
                  onClick={() => void handleTranscribe()}
                  className="w-full border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]"
                >
                  {transcribing ? (
                    <Spinner className="mr-2 h-3.5 w-3.5" />
                  ) : (
                    <FileText className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {transcribing
                    ? `${t("meeting.transcribeRecording")} ${progress ?? 0}%`
                    : t("meeting.transcribeRecording")}
                </Button>
                {!draft && (
                  <p className="text-[11px] leading-relaxed text-white/50">
                    {t("meeting.transcriptSavedNote")}
                  </p>
                )}
                {sttUnavailable && (
                  <p className="text-[11px] leading-relaxed text-limestone-ink">
                    {t("team.sttUnavailable")}
                  </p>
                )}
              </div>

              {/* merged, editable transcript */}
              <div className="space-y-2">
                <Textarea
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  rows={8}
                  aria-label={t("meeting.transcript")}
                  className="rounded-none border-white/20 bg-black/20 text-[13px] text-[#F5F1EA] focus-visible:ring-gold"
                />
                {consentMissing !== null && consentMissing > 0 && (
                  <p className="text-[11px] leading-relaxed text-limestone-ink">
                    Waiting for {consentMissing} participant(s) to consent —
                    saving stays blocked until everyone acknowledges.
                  </p>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    savingTranscript ||
                    !transcriptText.trim() ||
                    consentMissing !== 0
                  }
                  onClick={() => void handleSaveTranscript()}
                  className="w-full bg-gold text-cobble-ink hover:bg-gold/90"
                >
                  {savingTranscript && <Spinner className="mr-2 h-3.5 w-3.5" />}
                  {t("meeting.saveTranscript")}
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ── controls ── */}
      <footer className="border-t border-white/10 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("meeting.mic")}
            title={t("meeting.mic")}
            onClick={toggleMic}
            className={cn(
              "border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]",
              !state.micEnabled && "border-coral/60 text-coral-ink"
            )}
          >
            {state.micEnabled ? (
              <Mic className="h-4 w-4" aria-hidden="true" />
            ) : (
              <MicOff className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>

          {isVideo && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("meeting.camera")}
              title={t("meeting.camera")}
              onClick={toggleCamera}
              className={cn(
                "border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]",
                !state.cameraEnabled && "border-coral/60 text-coral-ink"
              )}
            >
              {state.cameraEnabled ? (
                <Camera className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CameraOff className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}

          {isHost && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={savingRecording}
                onClick={handleRecord}
                className={cn(
                  "border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]",
                  recording && "border-coral/60"
                )}
              >
                {recording ? (
                  <Square
                    className="mr-1.5 h-3.5 w-3.5 text-coral-ink"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="mr-1.5 h-3.5 w-3.5 text-coral-ink"
                    aria-hidden="true"
                  />
                )}
                {recording ? t("meeting.stopRecording") : t("meeting.record")}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={panelOpen}
                onClick={() => {
                  setPanelOpen((v) => !v);
                  refreshConsent();
                }}
                className="border-white/30 bg-transparent text-[#F5F1EA] hover:bg-white/10 hover:text-[#F5F1EA]"
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t("meeting.transcript")}
              </Button>
            </>
          )}

          {recording && (
            <span className="inline-flex items-center gap-1.5 rounded border border-coral/50 bg-coral/10 px-2 py-1 text-[11px] font-medium text-coral-ink">
              <span
                className="h-2 w-2 animate-pulse rounded-full bg-coral"
                aria-hidden="true"
              />
              {t("meeting.recording")} ·{" "}
              {formatClock(Math.floor(recordingMs / 1000))}
            </span>
          )}

          <Button
            type="button"
            onClick={handleLeave}
            className="bg-coral text-danger-ink hover:bg-coral/90"
          >
            <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("meeting.leave")}
          </Button>

          {isHost && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEndOpen(true)}
              className="border-coral/50 bg-transparent text-coral-ink hover:bg-coral/10 hover:text-coral-ink"
            >
              {t("meeting.endForAll")}
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-white/50">
          {t("meeting.pttHold")}
        </p>
      </footer>

      {/* ── consent dialog (before the first recording of the session) ── */}
      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-editorial text-cobble-ink">
              {t("meeting.record")}
            </DialogTitle>
            <DialogDescription>
              {t("meeting.recordingConsent")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentOpen(false)}>
              {t("common.cancel")}
            </Button>
            {consentMissing !== null && consentMissing > 0 && (
              <p className="text-[13px] leading-relaxed text-cobble-ink/70">
                Waiting for {consentMissing} participant(s) to consent —
                recording stays blocked until everyone acknowledges.
              </p>
            )}
            <Button
              onClick={() => {
                // Stamp my own ack first; the server still requires every
                // counterparty's ack before storing a single byte.
                void api.meetingAckRecording(meeting.id).catch(() => undefined);
                setConsentGiven(true);
                setConsentOpen(false);
                refreshConsent();
                startRecording();
              }}
            >
              {t("meeting.record")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── end-for-everyone confirm ── */}
      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("meeting.endForAll")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("meeting.endConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setEndOpen(false);
                handleEndAll();
              }}
            >
              {t("meeting.endForAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
