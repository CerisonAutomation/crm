"use client";
/**
 * Scribe — on-device speech-to-text with Whisper (Transformers.js).
 *
 * Runs entirely in the browser (WebGPU when available, WASM otherwise) using the
 * multilingual Whisper "tiny" model. Two entry points:
 *   · `transcribeSamples` — transcribe a PCM buffer off a file/recording.
 *   · `createStreamScribe` — live dictation from a MediaStream: captures PCM via
 *     the Web Audio API, buffers ~4 s windows and transcribes them in sequence.
 *
 * Callers should fall back to the Web Speech API (or a plain no-op) when the
 * pipeline cannot load; nothing here throws.
 */
import { detectCapabilities } from "./capabilities";
import { getPipeline, warmModel, type PipelineProgress } from "./pipelines";

/**
 * Whisper *lite* — the smallest models, picked per language for maximum speed
 * on any device (the pattern used by xenova/whisper-web and browser-whisper).
 */
const WHISPER_MULTILINGUAL = "Xenova/whisper-tiny"; // ~75 MB · 99 languages
const WHISPER_ENGLISH = "Xenova/whisper-tiny.en"; // ~40 MB · English only (fastest)
const TARGET_RATE = 16_000;

/** The lightest usable Whisper model for the language at hand. */
function whisperLite(language?: string): string {
  return (language ?? "en").trim().toLowerCase().startsWith("en")
    ? WHISPER_ENGLISH
    : WHISPER_MULTILINGUAL;
}

export type ScribeStatus =
  "idle" | "loading" | "listening" | "transcribing" | "error";

type AsrPipeline = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

/** Best-effort: is a Whisper pipeline plausible on this device? */
export function scribeAvailable(): boolean {
  const caps = detectCapabilities();
  return caps.wasm || caps.webgpu;
}

/** Preload the Whisper model during idle so the first transcription is fast. */
export function warmScribe(language?: string): void {
  void warmModel("automatic-speech-recognition", whisperLite(language));
}

/** Linear resample to 16 kHz mono (what Whisper expects). */
function resample(
  input: Float32Array,
  inputRate: number,
  outputRate = TARGET_RATE,
): Float32Array {
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

/** Transcribe a PCM buffer (mono). Returns "" when the model is unavailable. */
export async function transcribeSamples(
  samples: Float32Array,
  opts: { language?: string; onProgress?: PipelineProgress } = {},
): Promise<string> {
  if (samples.length < TARGET_RATE * 0.2) return ""; // < 200 ms — nothing useful
  const pipe = await getPipeline(
    "automatic-speech-recognition",
    whisperLite(opts.language),
    { onProgress: opts.onProgress },
  );
  if (!pipe) return "";
  try {
    const out = await (pipe as AsrPipeline)(samples, {
      language: opts.language ?? null,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false, // lite: skip word/segment timestamps (faster)
    });
    const text = Array.isArray(out) ? (out[0]?.text ?? "") : (out?.text ?? "");
    return text.trim();
  } catch {
    return "";
  }
}

export type StreamScribe = {
  start: (stream: MediaStream) => Promise<void>;
  stop: () => void;
  /**
   * Transcribe everything buffered so far and resolve once the model is idle.
   * Used by push-to-talk: releasing the key must not discard the trailing
   * window, so the caller awaits this before tearing the stream down.
   */
  flush: () => Promise<void>;
};

/**
 * Live dictation from a MediaStream. `onFinal` fires once per transcribed
 * window; `onStatus` reports the model/engine state for the UI.
 */
export function createStreamScribe(opts: {
  language?: string;
  /** How often a buffered window is transcribed (ms). */
  chunkMs?: number;
  onFinal: (text: string) => void;
  onStatus?: (s: ScribeStatus) => void;
  onProgress?: PipelineProgress;
}): StreamScribe {
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;
  let sampleRate = 48_000;
  let windows: Float32Array[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function flush() {
    if (busy) return;
    const total = windows.reduce((n, w) => n + w.length, 0);
    if (total < sampleRate * 0.4) return;
    busy = true;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const w of windows) {
      merged.set(w, offset);
      offset += w.length;
    }
    windows = [];
    try {
      opts.onStatus?.("transcribing");
      const text = await transcribeSamples(resample(merged, sampleRate), {
        language: opts.language,
        onProgress: opts.onProgress,
      });
      if (text) opts.onFinal(text);
      opts.onStatus?.("listening");
    } catch {
      opts.onStatus?.("error");
    } finally {
      busy = false;
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Wait for any in-flight window, transcribe what remains, then wait again. */
  async function drain() {
    let guard = 0;
    while (busy && guard++ < 100) await sleep(60);
    await flush();
    guard = 0;
    while (busy && guard++ < 100) await sleep(60);
  }

  return {
    async start(stream: MediaStream) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) {
          opts.onStatus?.("error");
          return;
        }
        ctx = new Ctor();
        sampleRate = ctx.sampleRate;
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          windows.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        // Route through a muted gain node — ScriptProcessor only ticks when it
        // reaches the destination, and we must not echo the mic to the speakers.
        sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(processor);
        processor.connect(sink);
        sink.connect(ctx.destination);
        opts.onStatus?.("listening");
        timer = setInterval(() => {
          void flush();
        }, opts.chunkMs ?? 4_000);
      } catch {
        opts.onStatus?.("error");
      }
    },
    flush: drain,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        processor?.disconnect();
        source?.disconnect();
        sink?.disconnect();
        void ctx?.close();
      } catch {
        /* noop */
      }
      processor = null;
      source = null;
      sink = null;
      ctx = null;
      windows = [];
    },
  };
}
