"use client";
/**
 * In-browser OCR via Tesseract.js — no server, no external AI.
 *
 * Accepts a File/Blob, an object URL, or a data URL and returns the recognised
 * text; the passport flow parses the MRZ from it.
 *
 * ENGINE ASSETS ARE SAME-ORIGIN, DELIBERATELY. Tesseract's defaults point at a
 * CDN (jsdelivr for the WASM core and worker, projectnaptha for the language
 * data), and this app's Content-Security-Policy trusts no third-party origin:
 * `connect-src 'self'` would block the fetches and `script-src` would block the
 * worker's `importScripts`. So the worker, the LSTM WASM core and the English
 * language data are vendored under `/public` and loaded from there. (That is
 * also the honest reading of the privacy promise on the legal page: no part of
 * reading a passport — engine, language data or the document itself — leaves
 * the visitor's browser.)
 *
 * The three core builds are the plain, SIMD and relaxed-SIMD LSTM variants:
 * the worker picks whichever the browser supports, and each `.wasm.js` embeds
 * its binary, so no sibling `.wasm` request is made. They are fetched only when
 * a visitor actually scans a document, never on first paint.
 */

const TESSERACT_ASSETS = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/",
  langPath: "/tessdata",
} as const;

export type BrowserOcrResult = {
  text: string;
  provider: "tesseract-browser";
  /** 0–1 */
  confidence: number;
};

type TesseractWorker = {
  recognize: (image: Blob | string) => Promise<{ data: { text?: string; confidence?: number } }>;
  terminate: () => Promise<unknown>;
};

type TesseractLike = {
  createWorker: (
    langs?: string,
    oem?: number,
    options?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<TesseractWorker>;
};

export async function ocrImage(
  image: Blob | string,
  opts: {
    lang?: string;
    onProgress?: (percent: number) => void;
    /**
     * Restrict the recogniser to the characters the document can legally hold.
     * An MRZ is the case that needs it: left open, the engine renders its `<`
     * padding as `«`, `(`, `L` or `K`, and the name comes out with the filler
     * spliced into it. Narrowing the charset also removes punctuation noise.
     */
    whitelist?: string;
    /** Tesseract page-segmentation mode. "6" = one uniform block of text. */
    psm?: string;
  } = {}
): Promise<BrowserOcrResult> {
  const mod = (await import("tesseract.js")) as unknown as TesseractLike & {
    default?: TesseractLike;
  };
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  if (typeof createWorker !== "function") throw new Error("tesseract.js createWorker() is unavailable");

  const worker = await createWorker(
    opts.lang ?? "eng",
    undefined,
    {
      ...TESSERACT_ASSETS,
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === "recognizing text") opts.onProgress?.(Math.round((m.progress ?? 0) * 100));
      },
    },
    {
      ...(opts.whitelist ? { tessedit_char_whitelist: opts.whitelist } : {}),
      ...(opts.psm ? { tessedit_pageseg_mode: opts.psm } : {}),
    }
  );

  try {
    const { data } = await worker.recognize(image);
    return {
      text: data?.text ?? "",
      provider: "tesseract-browser",
      confidence: typeof data?.confidence === "number" ? data.confidence / 100 : 0,
    };
  } finally {
    // The worker holds a WASM heap; leaving it alive for a one-shot scan leaks
    // it for the lifetime of the page.
    await worker.terminate().catch(() => undefined);
  }
}
