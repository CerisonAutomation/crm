/**
 * Authoritative (second-stage) OCR pipeline.
 *
 * Returns a sealed receipt (no raw engine fields). Provisional extracted
 * fields come ONLY from the independently re-verified MRZ (R1).
 */
import { createHash } from "node:crypto";
import { buildMrzCandidate } from "./provisional";
import { qualityFromConfidence } from "./types";
import { normalizeOcrText } from "./normalize";
import { buildSearchablePdf, buildSidecar } from "./searchable-pdf";
import type { MrzCandidate } from "./types";

export function verifyAuthoritativeMrz(input: { line1: string; line2: string } | null): MrzCandidate | null {
  if (!input) return null;
  return buildMrzCandidate(input.line1 + "\n" + input.line2);
}

export type RunAuthoritativeOcrInput = {
  documentId: string;
  bytes: Buffer;
  mimeType: string;
  store: (args: { suffix: string; bytes: Buffer }) => Promise<string>;
};

export type AuthoritativeReceipt = {
  confidence: number;
  model: string;
  inputSha256: string;
  quality: string;
  mrz: ReturnType<typeof buildMrzCandidate>;
  decision: string;
  pdfKey?: string;
  sidecarKey?: string;
};

export async function runAuthoritativeOcr(input: RunAuthoritativeOcrInput): Promise<AuthoritativeReceipt> {
  const inputSha256 = createHash("sha256").update(input.bytes).digest("hex");
  // No real OCR engine in this build; return a sealed, low-confidence receipt.
  const text = "";
  const normalized = normalizeOcrText(text);
  const mrz = null;
  const confidence = 0;
  const quality = qualityFromConfidence(confidence, normalized.length);
  // Persist searchable PDF + sidecar (best effort).
  try {
    const pdf = buildSearchablePdf({ ocrText: normalized, jpeg: null });
    await input.store({ suffix: "pdf", bytes: pdf.pdfBytes });
    const sidecar = buildSidecar(normalized);
    await input.store({ suffix: "txt", bytes: Buffer.from(sidecar.text, "utf8") });
  } catch {
    // storage failures must not crash the pipeline
  }
  return {
    confidence,
    model: "authoritative-stub",
    inputSha256,
    quality,
    mrz,
    decision: "PENDING_REVIEW",
  };
}
