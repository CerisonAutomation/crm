"use client";
/**
 * Team voice notes — real capture + real on-device transcription.
 *
 * Everything here runs in the browser: a `MediaRecorder` captures the note, the
 * Web Speech API (when the browser exposes it) provides live captions, and the
 * shared on-device Whisper pipeline (`@/lib/ai/browser/pipelines`) produces the
 * transcript entirely on the user's machine. When the model or the browser
 * cannot do the job we say so plainly — we never fabricate a transcript.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getPipeline } from "@/lib/ai/browser/pipelines";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/brand/ui";
import { cn } from "@/lib/utils";
import { Mic, Square, Sparkles, X } from "lucide-react";

/**
 * The smallest multilingual Whisper that still transcribes Swiss-German-accented
 * speech acceptably. The pipeline layer caches it per session, so the one-time
 * download is shared by every transcription on the device.
 */
export const WHISPER_MODEL = "onnx-community/whisper-base";

const TARGET_RATE = 16_000;

/* ── small helpers ───────────────────────────────────────────── */

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read a Blob as base64 (the `data:` prefix is stripped). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read audio"));
    reader.readAsDataURL(blob);
  });
}

/** Linear-interpolation resampler (mono, to 16 kHz — what Whisper expects). */
function resampleLinear(input: Float32Array, inputRate: number, outputRate = TARGET_RATE): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

type AudioContextCtor = typeof AudioContext;
function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── recorder ────────────────────────────────────────────────── */

export type RecorderResult = { base64: string; mime: string; bytes: number; durationMs: number };

const RECORDER_STATES = ["idle", "recording", "stopping", "error"] as const;
export type RecorderState = (typeof RECORDER_STATES)[number];

export function useRecorder(): {
  state: RecorderState;
  seconds: number;
  level: number;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => Promise<RecorderResult | null>;
  cancel: () => void;
} {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("audio/webm");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const disposedRef = useRef(false);

  /** Stop the meter, the timer, the analyser and — crucially — every mic track. */
  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      streamRef.current = stream;

      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mime =
        typeof MediaRecorder !== "undefined"
          ? candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ""
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mimeRef.current = rec.mimeType || mime || "audio/webm";
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = rec;

      // Level meter — RMS of the time-domain waveform drives the gold bars.
      const Ctor = audioContextCtor();
      if (Ctor) {
        const ctx = new Ctor();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          const a = analyserRef.current;
          if (!a) return;
          a.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }

      secondsRef.current = 0;
      setSeconds(0);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);

      rec.start();
      setState("recording");
      return true;
    } catch {
      setError("microphone");
      setState("error");
      teardown();
      return false;
    }
  }, [teardown]);

  const stop = useCallback(async (): Promise<RecorderResult | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return null;
    setState("stopping");
    const result = await new Promise<RecorderResult | null>((resolve) => {
      let settled = false;
      const finish = (value: RecorderResult | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      rec.onstop = () => {
        const mime = mimeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        void blobToBase64(blob)
          .then((base64) => finish({ base64, mime, bytes: blob.size, durationMs: secondsRef.current * 1000 }))
          .catch(() => finish(null));
      };
      try {
        rec.stop();
      } catch {
        finish(null);
      }
    });
    recorderRef.current = null;
    teardown();
    setLevel(0);
    setState("idle");
    return result;
  }, [teardown]);

  const cancel = useCallback(() => {
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
    chunksRef.current = [];
    teardown();
    secondsRef.current = 0;
    setSeconds(0);
    setLevel(0);
    setError(null);
    setState("idle");
  }, [teardown]);

  // Unmount safety — never leave the microphone hot.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
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
      teardown();
    };
  }, [teardown]);

  return { state, seconds, level, error, start, stop, cancel };
}

/* ── live captions (Web Speech API) ──────────────────────────── */

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SPEECH_LANG: Record<string, string> = {
  en: "en-US",
  de: "de-CH",
  fr: "fr-CH",
  it: "it-CH",
};

export function useLiveCaptions(): {
  supported: boolean;
  text: string;
  listening: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
} {
  const { locale } = useI18n();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  const supported = recognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    finalRef.current = "";
    setText("");
    setError(null);
    const rec = new Ctor();
    rec.lang = SPEECH_LANG[locale] ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      const clean = finalText.trim();
      if (clean) {
        finalRef.current = `${finalRef.current}${finalRef.current ? " " : ""}${clean}`;
        setText(finalRef.current);
      }
    };
    rec.onerror = (e) => setError(String(e?.error ?? "error"));
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [locale]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
    },
    [],
  );

  return { supported, text, listening, start, stop, error };
}

/* ── on-device transcription ─────────────────────────────────── */

export type TranscribeProgress = { status: string; progress: number; file?: string };

async function decodeToMono16k(base64: string): Promise<Float32Array> {
  const bytes = base64ToBytes(base64);
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error("No AudioContext available");
  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    return resampleLinear(mono, buffer.sampleRate);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

type AsrOutput = { text?: string; chunks?: Array<{ timestamp: [number, number]; text: string }> };
type AsrPipeline = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>;

/**
 * Transcribe an audio note entirely on the device. Resolves to `null` when the
 * model/browser cannot do the job — never to a fabricated string.
 */
export async function transcribeAudio(
  input: { base64: string; mime: string },
  onProgress?: (p: TranscribeProgress) => void,
): Promise<{ text: string; segments: number } | null> {
  let samples: Float32Array;
  try {
    samples = await decodeToMono16k(input.base64);
  } catch {
    return null;
  }
  if (samples.length < TARGET_RATE * 0.2) return null; // < 200 ms — nothing to hear

  const pipe = await getPipeline("automatic-speech-recognition", WHISPER_MODEL, { onProgress });
  if (!pipe) return null;

  try {
    const out = await (pipe as AsrPipeline)(samples, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    const first = Array.isArray(out) ? out[0] : out;
    const text = (first?.text ?? "").trim();
    const segments = Array.isArray(first?.chunks) ? first.chunks.length : 0;
    return { text, segments };
  } catch {
    return null;
  }
}

/* ── recorder UI ─────────────────────────────────────────────── */

const BAR_HEIGHTS = ["h-[6px]", "h-[10px]", "h-[14px]", "h-[18px]", "h-[22px]"];

export type VoiceNoteSend = {
  base64: string;
  mime: string;
  durationMs: number;
  transcript: string | null;
};

type Preview = { url: string; base64: string; mime: string; durationMs: number };

export function VoiceNoteRecorder({
  onSend,
  disabled,
}: {
  onSend: (p: VoiceNoteSend) => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const rec = useRecorder();
  const captions = useLiveCaptions();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sttUnavailable, setSttUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview(null);
    setTranscriptText("");
    setSttUnavailable(false);
    setProgress(null);
  }, []);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  async function handleStart() {
    clearPreview();
    const ok = await rec.start();
    if (ok && captions.supported) captions.start();
  }

  async function handleStop() {
    const result = await rec.stop();
    captions.stop();
    if (!result) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const bytes = base64ToBytes(result.base64);
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: result.mime }));
    previewUrlRef.current = url;
    setPreview({ url, base64: result.base64, mime: result.mime, durationMs: result.durationMs });
    setTranscriptText(captions.text);
  }

  function handleCancel() {
    rec.cancel();
    captions.stop();
    clearPreview();
  }

  async function handleTranscribe() {
    if (!preview) return;
    setTranscribing(true);
    setProgress(0);
    setSttUnavailable(false);
    const out = await transcribeAudio({ base64: preview.base64, mime: preview.mime }, (p) => setProgress(p.progress));
    setTranscribing(false);
    setProgress(null);
    const text = out?.text.trim() ?? "";
    if (!text) {
      setSttUnavailable(true);
      return;
    }
    setTranscriptText((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
  }

  async function handleSend() {
    if (!preview) return;
    setSending(true);
    try {
      await onSend({
        base64: preview.base64,
        mime: preview.mime,
        durationMs: preview.durationMs,
        transcript: transcriptText.trim() || null,
      });
      clearPreview();
    } catch {
      /* send already surfaced its own error — keep the preview */
    } finally {
      setSending(false);
    }
  }

  const recording = rec.state === "recording";
  const busy = rec.state === "stopping";

  if (preview) {
    return (
      <div className="w-full rounded-md border border-border bg-card p-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("team.voiceNote")}
        </p>
        <audio controls src={preview.url} className="w-full" />
        <p className="text-xs text-iron-ink">{t("team.voiceDuration", { s: Math.round(preview.durationMs / 1000) })}</p>

        <div className="space-y-1.5">
          <label htmlFor="team-voice-transcript" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("team.transcript")}
          </label>
          <Textarea
            id="team-voice-transcript"
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={3}
            className="rounded-none border-input focus-visible:ring-gold"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={transcribing || sending}
            onClick={() => void handleTranscribe()}
          >
            {transcribing ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Sparkles className="mr-2 h-3.5 w-3.5 text-gold-ink" />}
            {transcribing ? `${t("team.transcribing")} ${progress ?? 0}%` : t("team.transcribe")}
          </Button>
        </div>

        {/* Honest status — one line for every state. */}
        {!captions.supported && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("team.sttListenerUnsupported")}</p>
        )}
        {sttUnavailable && (
          <p className="text-[11px] leading-relaxed text-amber-ink">{t("team.sttUnavailable")}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
            disabled={sending}
            onClick={() => void handleSend()}
          >
            {sending && <Spinner className="mr-2 h-3.5 w-3.5" />}
            {t("team.send")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={handleCancel}>
            {t("team.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {recording ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("team.stop")}
            title={t("team.stop")}
            onClick={() => void handleStop()}
          >
            <Square className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="font-mono text-sm tabular-nums text-iron-ink">{formatClock(rec.seconds)}</span>
          <span className="flex items-end gap-0.5" aria-hidden="true">
            {BAR_HEIGHTS.map((h, i) => (
              <span
                key={i}
                className={cn("w-1 rounded-sm transition-colors", h, rec.level * 5 > i ? "bg-gold" : "bg-gold/25")}
              />
            ))}
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-danger-ink" onClick={handleCancel}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("team.cancel")}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled || busy}
          aria-label={t("team.record")}
          title={t("team.record")}
          onClick={() => void handleStart()}
        >
          {busy ? <Spinner className="h-4 w-4" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
        </Button>
      )}
      {rec.state === "error" && <span className="text-[11px] text-danger-ink">{t("team.micDenied")}</span>}
    </div>
  );
}
