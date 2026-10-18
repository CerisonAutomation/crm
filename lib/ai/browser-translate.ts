"use client";
/**
 * In-browser translation — nothing leaves the device. No server, no external AI.
 *
 * Order of preference:
 *  1. The browser's built-in on-device Translation API (`Translator`).
 *  2. Transformers.js NLLB via the shared pipeline layer (`./browser/pipelines`),
 *     which selects WebGPU/WASM + precision from the device capability probe.
 *  3. Honest fallback: return the original text, flagged as untranslated.
 */
import { getPipeline } from "./browser/pipelines";

export type TranslateEngine = "browser-api" | "transformers" | "none";
export type TranslateResult = {
  text: string;
  translated: boolean;
  engine: TranslateEngine;
};
export type ModelProgress = {
  status: "downloading" | "ready";
  progress: number;
  file?: string;
};

const MAX_CHARS = 600;
const NLLB_MODEL = "Xenova/nllb-200-distilled-600M";

/** BCP-47 tags for the built-in API. */
const BCP47: Record<string, string> = {
  en: "en",
  de: "de",
  fr: "fr",
  it: "it",
  es: "es",
  pt: "pt",
  nl: "nl",
  ar: "ar",
  zh: "zh",
  ru: "ru",
};
/** FLORES-200 codes for NLLB. */
const NLLB: Record<string, string> = {
  en: "eng_Latn",
  de: "deu_Latn",
  fr: "fra_Latn",
  it: "ita_Latn",
  es: "spa_Latn",
  pt: "por_Latn",
  nl: "nld_Latn",
  ar: "arb_Arab",
  zh: "zho_Hans",
  ru: "rus_Cyrl",
};
const code2 = (code: string) => code.trim().toLowerCase().slice(0, 2);

/* ── 1. built-in browser Translation API ─────────────────────── */

type BuiltInTranslator = { translate: (text: string) => Promise<string> };
type BuiltInCtor = {
  create: (opts: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<BuiltInTranslator>;
};

function builtInCtor(): BuiltInCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Translator?: BuiltInCtor };
  return typeof w.Translator?.create === "function" ? w.Translator : null;
}

const builtInCache = new Map<string, Promise<BuiltInTranslator | null>>();

function builtInTranslator(
  source: string,
  target: string
): Promise<BuiltInTranslator | null> {
  const Ctor = builtInCtor();
  if (!Ctor) return Promise.resolve(null);
  const key = `${source}>${target}`;
  const cached = builtInCache.get(key);
  if (cached) return cached;
  const created = Ctor.create({
    sourceLanguage: source,
    targetLanguage: target,
  }).catch(() => null);
  builtInCache.set(key, created);
  return created;
}

/* ── public API ──────────────────────────────────────────────── */

type TranslationRunner = (
  text: string,
  opts: Record<string, unknown>
) => Promise<Array<{ translation_text: string }>>;

export async function translateInBrowser(
  text: string,
  opts: {
    source: string;
    target: string;
    onProgress?: (p: ModelProgress) => void;
  }
): Promise<TranslateResult> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!clean) return { text: "", translated: false, engine: "none" };

  const source = BCP47[code2(opts.source)] ?? "en";
  const target = BCP47[code2(opts.target)] ?? "en";
  if (source === target)
    return { text: clean, translated: true, engine: "none" };

  // 1) built-in on-device model
  const builtIn = await builtInTranslator(source, target);
  if (builtIn) {
    try {
      const out = await builtIn.translate(clean);
      if (out?.trim())
        return { text: out.trim(), translated: true, engine: "browser-api" };
    } catch {
      /* fall through to Transformers.js */
    }
  }

  // 2) Transformers.js NLLB (shared pipeline layer → WebGPU/WASM + tiered dtype)
  const pipe = await getPipeline("translation", NLLB_MODEL, {
    onProgress: (p) =>
      opts.onProgress?.({
        status: p.status === "downloading" ? "downloading" : "ready",
        progress: p.progress,
        file: p.file,
      }),
  });
  if (pipe) {
    try {
      const out = await (pipe as TranslationRunner)(clean, {
        src_lang: NLLB[code2(opts.source)] ?? "eng_Latn",
        tgt_lang: NLLB[code2(opts.target)] ?? "eng_Latn",
        max_new_tokens: 256,
      });
      const translatedText = out?.[0]?.translation_text?.trim();
      if (translatedText)
        return {
          text: translatedText,
          translated: true,
          engine: "transformers",
        };
    } catch {
      /* fall through */
    }
  }

  // 3) honest fallback
  return { text: clean, translated: false, engine: "none" };
}
