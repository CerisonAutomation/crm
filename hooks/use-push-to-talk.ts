"use client";
/**
 * usePushToTalk — hold-to-speak control with INSTANT feedback.
 *
 * Two engines, picked once per session, no API keys, audio never leaves the
 * device when the local model is used:
 *   · **Web Speech API** (`SpeechRecognition`) — streamed *interim* results, so
 *     the transcript appears as you speak. This is the instant path (Chrome,
 *     Edge, Safari). Nothing is awaited until you release.
 *   · **Scribe (local Whisper via Transformers.js)** — used when the browser has
 *     no recogniser. Audio is captured and transcribed on release (WebGPU/WASM),
 *     fully offline.
 *
 * Contract: `begin()` starts capture, `end()` finalises and resolves the
 * transcript (awaiting the trailing window so a release never drops words),
 * `cancel()` aborts. All calls are idempotent and safe to call from pointer,
 * touch and keyboard handlers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createStreamScribe, scribeAvailable, type StreamScribe } from "@/lib/ai/browser/scribe";

export type PttEngine = "web-speech" | "whisper" | "none";
export type PttPhase = "idle" | "listening" | "processing";

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; 0: SpeechAlternative };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Safety release: a held key must never record forever. */
const MAX_HOLD_MS = 30_000;
/** How long to wait for the recogniser to flush its last words after stop(). */
const FINALISE_TIMEOUT_MS = 1_500;

export function usePushToTalk(locale: string) {
  const [engine, setEngine] = useState<PttEngine>("none");
  const [phase, setPhase] = useState<PttPhase>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const scribeRef = useRef<StreamScribe | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const finalRef = useRef("");
  const disposedRef = useRef(false);
  const activeRef = useRef(false);
  const endingRef = useRef<Promise<string> | null>(null);
  const startingRef = useRef<Promise<void> | null>(null);
  const endResolveRef = useRef<((t: string) => void) | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localeRef = useRef(locale);
  // Written in an effect, never during render: a render-phase ref write is a
  // tearing hazard once React can discard and replay a render.
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  // Engine is chosen once, on the client (window is available here: the shell
  // only mounts post-hydration).
  useEffect(() => {
    setEngine(recognitionCtor() ? "web-speech" : scribeAvailable() ? "whisper" : "none");
  }, []);

  const teardown = useCallback(() => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    recRef.current = null;
    scribeRef.current?.stop();
    scribeRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    activeRef.current = false;
    setInterim("");
  }, []);

  const cancel = useCallback(() => {
    const resolve = endResolveRef.current;
    endResolveRef.current = null;
    try {
      recRef.current?.abort();
    } catch {
      /* not started */
    }
    teardown();
    endingRef.current = null;
    finalRef.current = "";
    setPhase("idle");
    resolve?.("");
  }, [teardown]);

  const end = useCallback(async (): Promise<string> => {
    if (endingRef.current) return endingRef.current;
    // Pointer release can arrive while getUserMedia/Scribe is still arming.
    // Wait for that startup transaction instead of returning an empty command
    // and leaving the microphone alive after the user has released.
    if (startingRef.current) await startingRef.current;
    if (!activeRef.current) return finalRef.current.trim();

    const run = (async (): Promise<string> => {
      setPhase("processing");
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }

      const rec = recRef.current;
      if (rec) {
        const settled = new Promise<string>((resolve) => {
          endResolveRef.current = resolve;
          endTimerRef.current = setTimeout(() => {
            endResolveRef.current = null;
            resolve(finalRef.current.trim());
          }, FINALISE_TIMEOUT_MS);
        });
        try {
          rec.stop();
        } catch {
          /* already ended */
        }
        const text = await settled;
        teardown();
        setPhase("idle");
        return text;
      }

      // Whisper fallback: flush the trailing audio window before tearing down.
      if (scribeRef.current) {
        await scribeRef.current.flush();
      }
      teardown();
      setPhase("idle");
      return finalRef.current.trim();
    })();

    endingRef.current = run;
    try {
      return await run;
    } finally {
      endingRef.current = null;
    }
  }, [teardown]);

  const begin = useCallback(() => {
    if (activeRef.current || endingRef.current) return;
    setError(null);
    finalRef.current = "";
    setInterim("");

    const ctor = recognitionCtor();
    if (ctor) {
      const rec = new ctor();
      rec.lang = localeRef.current || "en";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let finalText = "";
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
        if (finalText.trim()) {
          finalRef.current = `${finalRef.current}${finalRef.current ? " " : ""}${finalText.trim()}`;
        }
        setInterim(finalText.trim() || interimText);
      };
      rec.onerror = (e) => {
        const code = String(e?.error ?? "error");
        if (code === "no-speech" || code === "aborted") return;
        setError(code === "not-allowed" || code === "service-not-allowed" ? "permission" : code);
      };
      rec.onend = () => {
        const resolve = endResolveRef.current;
        endResolveRef.current = null;
        if (endTimerRef.current) {
          clearTimeout(endTimerRef.current);
          endTimerRef.current = null;
        }
        activeRef.current = false;
        setInterim("");
        resolve?.(finalRef.current.trim());
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        // A previous session may still be closing — retry once, then give up.
        try {
          rec.abort();
          rec.start();
        } catch {
          setError("start-failed");
          teardown();
          setPhase("idle");
          return;
        }
      }
      activeRef.current = true;
      setPhase("listening");
      autoTimerRef.current = setTimeout(() => void end(), MAX_HOLD_MS);
      return;
    }

    // No recogniser — capture raw audio and transcribe on release with Whisper.
    if (scribeAvailable()) {
      startingRef.current = (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (disposedRef.current) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          micRef.current = stream;
          const scribe = createStreamScribe({
            language: localeRef.current,
            onFinal: (t) => {
              finalRef.current = `${finalRef.current}${finalRef.current ? " " : ""}${t}`;
              setInterim(t);
            },
            onStatus: (s) => {
              if (s === "error") setError("scribe-error");
            },
          });
          scribeRef.current = scribe;
          await scribe.start(stream);
          activeRef.current = true;
          setPhase("listening");
          autoTimerRef.current = setTimeout(() => void end(), MAX_HOLD_MS);
        } catch {
          setError("permission");
          setPhase("idle");
        }
      })().finally(() => { startingRef.current = null; });
      return;
    }

    setError("unsupported");
  }, [end, teardown]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      teardown();
    };
  }, [teardown]);

  return {
    /** Whether any speech engine is present on this device. */
    supported: engine !== "none",
    engine,
    phase,
    listening: phase === "listening",
    processing: phase === "processing",
    interim,
    error,
    begin,
    end,
    cancel,
  };
}
