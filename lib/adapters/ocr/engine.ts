/**
 * OCR port + adapter (server-only).
 *
 * Tesseract.js — a fully local WASM engine — extracts text with machine-readable
 * zone (TD3) parsing. There is no model backend: browser AI only, nothing to
 * configure, no network. Any engine/asset failure falls through to a labelled
 * deterministic sandbox result, never a faked extraction.
 */
import { extractMrzLines, parseTd3, verifyTd3CheckDigits, MRZ_CHARSET } from "@/lib/domain/mrz";
import { classifyDocument, type DocumentClassification } from "@/lib/domain/mrz-classify";
import { createHash } from "node:crypto";

export type ExtractedFieldResult = {
  fieldKey: string;
  value: string | null;
  confidence: number;
};

export type OcrResult = {
  provider: string;
  engineVersion: string;
  inputSha256: string;
  passCount: number;
  metadata: Record<string, unknown>;
  confidence: number;
  fields: ExtractedFieldResult[];
  /** Raw recognised text (populated by live passes; empty on fallback). */
  text?: string;
  error?: string;
};

const FIELD_KEYS = [
  "fullName",
  "documentNumber",
  "nationality",
  "dateOfBirth",
  "dateOfExpiry",
  "issuingCountry",
] as const;

const SANDBOX_ERROR =
  "Live OCR provider unreachable — sandbox extraction used. Values are placeholders and must be reviewed.";

/** Deterministic fallback — explicitly labelled, never presented as live extraction. */
function sandboxFallback(reason: string): OcrResult {
  console.warn("[ocr] provider unavailable, using deterministic sandbox fallback:", reason);
  return {
    provider: "sandbox-fallback",
    engineVersion: "sandbox-fallback/v1",
    inputSha256: "",
    passCount: 0,
    metadata: { fallback: true, reason },
    confidence: 0.42,
    text: "",
    error: SANDBOX_ERROR,
    fields: FIELD_KEYS.map((k) => ({ fieldKey: k, value: null, confidence: 0.42 })),
  };
}

/** Confidence thresholds for field-level review */
const FIELD_REVIEW_THRESHOLDS = {
  CRITICAL: 0.95,
  HIGH: 0.85,
  MEDIUM: 0.70,
};

/** Image quality thresholds */
const QUALITY_THRESHOLDS = {
  excellent: 0.9,
  good: 0.75,
  fair: 0.6,
  poor: 0.4,
};

type OcrQuality = "excellent" | "good" | "fair" | "poor";

/** Assess image quality based on OCR confidence and text characteristics. */
function assessQuality(confidence: number, textLength: number): OcrQuality {
  if (textLength < 50) return "poor";
  if (textLength < 100 && confidence < QUALITY_THRESHOLDS.good) return "fair";
  if (confidence >= QUALITY_THRESHOLDS.excellent) return "excellent";
  if (confidence >= QUALITY_THRESHOLDS.good) return "good";
  if (confidence >= QUALITY_THRESHOLDS.fair) return "fair";
  return "poor";
}

/** Select PSM modes based on document type and previous confidence. */
function selectPsModes(
  documentType: DocumentClassification | null,
  previousConfidence: number,
): string[] {
  if (documentType?.type === "PASSPORT") {
    return ["11", "6", "3"];
  }
  if (previousConfidence < QUALITY_THRESHOLDS.good) {
    return ["3", "6", "11"];
  }
  return ["3", "11"];
}

/** Calculate field-level confidence with review requirements. */
function calculateFieldConfidence(
  fieldKey: string,
  value: string | null,
  baseConfidence: number,
  documentType: DocumentClassification | null,
): { confidence: number; needsReview: boolean } {
  if (!value) {
    return { confidence: 0, needsReview: true };
  }

  let threshold = FIELD_REVIEW_THRESHOLDS.MEDIUM;
  if (["documentNumber", "dateOfBirth", "dateOfExpiry"].includes(fieldKey)) {
    threshold = FIELD_REVIEW_THRESHOLDS.CRITICAL;
  } else if (["fullName", "nationality"].includes(fieldKey)) {
    threshold = FIELD_REVIEW_THRESHOLDS.HIGH;
  }

  let adjustedConfidence = baseConfidence;
  if (documentType && documentType.type === "PASSPORT") {
    if (documentType.checks.documentNumber && fieldKey === "documentNumber") {
      adjustedConfidence = Math.min(1, baseConfidence * 1.1);
    }
    if (documentType.checks.dateOfBirth && fieldKey === "dateOfBirth") {
      adjustedConfidence = Math.min(1, baseConfidence * 1.1);
    }
    if (documentType.checks.dateOfExpiry && fieldKey === "dateOfExpiry") {
      adjustedConfidence = Math.min(1, baseConfidence * 1.1);
    }
  }

  return {
    confidence: adjustedConfidence,
    needsReview: adjustedConfidence < threshold,
  };
}

/** Pre-detect document type from initial OCR pass. */
function preDetectDocumentType(text: string): DocumentClassification | null {
  const hasMrzPattern = /^[A-Z0-9<]{25,}$/m.test(text.replace(/\s+/g, ""));
  if (!hasMrzPattern) return null;
  return classifyDocument(text);
}

/** Tesseract.js recognize function type */
type TesseractRecognize = (
  image: Buffer,
  langs?: string,
  options?: { psm?: string; whitelist?: string },
) => Promise<{ data: { text: string; confidence: number } }>;

/** Load Tesseract.js recognize function */
async function loadTesseract(): Promise<TesseractRecognize> {
  const mod = (await import("tesseract.js")) as unknown as {
    recognize?: TesseractRecognize;
    default?: { recognize?: TesseractRecognize };
  };
  const recognize = mod.recognize ?? mod.default?.recognize;
  if (typeof recognize !== "function") {
    throw new Error("tesseract.js recognize() is unavailable");
  }
  return recognize;
}

/** Single OCR pass with given parameters */
async function ocrPass(
  recognize: TesseractRecognize,
  base64: string,
  opts: { psm?: string; whitelist?: string } = {},
): Promise<{ text: string; confidence: number }> {
  const { data } = await recognize(Buffer.from(base64, "base64"), "eng", {
    psm: opts.psm,
    whitelist: opts.whitelist,
  });
  return { text: data?.text ?? "", confidence: data?.confidence ?? 0 };
}

/** Intelligent multi-pass OCR with adaptive parameter selection. */
async function runTesseractIntelligent(base64: string): Promise<OcrResult> {
  const recognize = await loadTesseract();

  let documentType: DocumentClassification | null = null;
  let bestText = "";
  let bestConfidence = 0;
  let passCount = 0;

  // First pass: auto-detect with default parameters
  const firstPass = await ocrPass(recognize, base64, { psm: "3" });
  passCount++;

  documentType = preDetectDocumentType(firstPass.text);
  bestText = firstPass.text;
  bestConfidence = firstPass.confidence;

  // If first pass is excellent quality, skip additional passes
  const firstQuality = assessQuality(firstPass.confidence, firstPass.text.trim().length);
  if (firstQuality !== "excellent" || firstPass.confidence < QUALITY_THRESHOLDS.good) {
    // Adaptive subsequent passes
    const modesToTry = selectPsModes(documentType, bestConfidence);

    for (let i = 1; i < 3 && bestConfidence < QUALITY_THRESHOLDS.good; i++) {
      const psm = modesToTry[i] ?? "3";
      const passResult = await ocrPass(recognize, base64, {
        psm,
        whitelist: documentType?.type === "PASSPORT" ? MRZ_CHARSET : undefined,
      });
      passCount++;

      if (passResult.confidence > bestConfidence) {
        bestText = passResult.text;
        bestConfidence = passResult.confidence;
      }

      // Re-classify with better text
      const newType = classifyDocument(passResult.text);
      if (newType && newType.confidence > (documentType?.confidence ?? 0)) {
        documentType = newType;
      }
    }
  }

  // Parse MRZ from best result
  const mrz = extractMrzLines(bestText);
  if (!mrz) {
    return {
      provider: "tesseract",
      engineVersion: "tesseract.js/local-wasm/v1",
      inputSha256: createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"),
      passCount,
      metadata: { documentType: documentType?.type ?? null, documentTypeConfidence: documentType?.confidence ?? null, quality: assessQuality(bestConfidence, bestText.trim().length), mrz: false },
      text: bestText,
      confidence: bestConfidence * 0.5,
      fields: FIELD_KEYS.map((k) => ({ fieldKey: k, value: null, confidence: bestConfidence * 0.5 })),
    };
  }

  const parsed = parseTd3(mrz.line1, mrz.line2);
  const mrzChecks = verifyTd3CheckDigits(mrz.line2);
  const mrzValid =
    mrzChecks.documentNumber && mrzChecks.dateOfBirth && mrzChecks.dateOfExpiry && mrzChecks.composite;
  const fields: ExtractedFieldResult[] = FIELD_KEYS.map((k) => {
    const value = parsed[k] ?? null;
    const { confidence } = calculateFieldConfidence(k, value, bestConfidence, documentType);
    return { fieldKey: k, value, confidence };
  });

  return {
    provider: "tesseract",
    engineVersion: "tesseract.js/local-wasm/v1",
    inputSha256: createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"),
    passCount,
    metadata: { documentType: documentType?.type ?? null, documentTypeConfidence: documentType?.confidence ?? null, quality: assessQuality(bestConfidence, bestText.trim().length) },
    confidence: bestConfidence,
    fields,
    text: bestText,
  };
}

/** Runs on a serverless host (Vercel / Lambda / Netlify). */
function onServerlessHost(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

export async function runOcr(documentId: string, base64: string, mimeType: string): Promise<OcrResult> {
  if (onServerlessHost()) {
    const result = sandboxFallback("server-side Tesseract worker is unavailable on a serverless host");
    result.inputSha256 = createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
    return result;
  }

  try {
    return await runTesseractIntelligent(base64);
  } catch (err) {
    const result = sandboxFallback((err as Error).message);
    result.inputSha256 = createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
    return result;
  }
}
