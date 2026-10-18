"use client";
/**
 * useSpeechToText — on-device speech-to-text.
 *
 * Prefers **Scribe** (Whisper via Transformers.js on WebGPU/WASM): a real local
 * model that works offline and keeps audio on the device. When the model cannot
 * load (unsupported device, no network for the one-time download), it falls back
 * to the browser's Web Speech API, and reports which engine is in use.
 *
 * Persisting the transcript is the caller's job (see the call overlay autosave).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createStreamScribe, scribeAvailable, warmScribe, type StreamScribe } from "@/lib/ai/browser/scribe";

export type SpeechEngine = "whisper" | "web-speech" | "none";

/* ── Web Speech fallback ─────────────────────────────────────── */

type SpeechEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (globalThis.window === undefined) return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ── hook ────────────────────────────────────────────────────── */

export function useSpeechToText(locale: string) {
  const [engine] = useState<SpeechEngine>(() => (scribeAvailable() ? "whisper" : recognitionCtor() ? "web-speech" : "none"));
  const supported = engine !== "none";

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const scribeRef = useRef<StreamScribe | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const finalRef = useRef("");
  const disposedRef = useRef(false);

  const append = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    finalRef.current = `${finalRef.current}${finalRef.current ? " " : ""}${clean}`;
    setTranscript(finalRef.current);
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    scribeRef.current?.stop();
    scribeRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(async () => {
    stop(); // never orphan an already-acquired stream
    setError(null);

    // 1) Scribe — on-device Whisper
    if (engine === "whisper") {
      try {
        warmScribe(locale); // start loading the model while we open the mic
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micRef.current = stream;
        const scribe = createStreamScribe({
          language: locale,
          onFinal: append,
          onStatus: (s) => {
            if (s === "error") setError("scribe-error");
            else if (s === "listening") setListening(true);
          },
        });
        scribeRef.current = scribe;
        await scribe.start(stream);
        if (disposedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setListening(true);
        return;
      } catch {
        setError("microphone");
        setListening(false);
        return;
      }
    }

    // 2) Web Speech fallback
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = locale || "en";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText.trim()) append(finalText);
      setInterim(interimText);
    };
    rec.onerror = (e) => setError(String(e?.error ?? "error"));
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [engine, locale, append, stop]);

  const reset = useCallback(() => {
    finalRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
      scribeRef.current?.stop();
      micRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { supported, engine, listening, transcript, interim, error, start, stop, reset };
}
