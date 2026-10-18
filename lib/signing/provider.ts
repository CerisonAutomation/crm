/**
 * Signing / QES seam (P1-2). No legal letter ships without a sealed-byte hash.
 *
 * Providers implement one method: seal the exact bytes stored in the vault and
 * return the integrity anchor. The default is the offline hash-stamp (HASH) —
 * deterministic, no network, no fake signatures. Documenso (QES envelopes) is
 * selected only when DOCUMENSO_API_URL + DOCUMENSO_API_KEY are configured;
 * otherwise it fails CLOSED so an unconfigured QES can never look signed.
 * Pure plus Node crypto only — zero framework imports (H1).
 */
import { createHash } from "node:crypto";

export type SignatureProviderName = "HASH" | "DOCUMENSO";

export type SealResult = {
  contentSha256: string;
  signatureProvider: SignatureProviderName;
  signatureRef: string;
  signedAt: Date;
};

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Offline default: stamp the sealed bytes with their own hash. */
export function hashStamp(bytes: Uint8Array | Buffer, now: Date = new Date()): SealResult {
  const contentSha256 = sha256Hex(bytes);
  return { contentSha256, signatureProvider: "HASH", signatureRef: "hash:" + contentSha256, signedAt: now };
}

export function documensoConfigured(): boolean {
  return Boolean(process.env.DOCUMENSO_API_URL && process.env.DOCUMENSO_API_KEY);
}

/** Provider no-op until the envelope call is implemented: fail closed. */
export function documensoSeal(): SealResult {
  if (!documensoConfigured()) {
    throw new Error("Documenso QES is not configured (DOCUMENSO_API_URL/DOCUMENSO_API_KEY) — refusing to mark bytes signed");
  }
  throw new Error("Documenso envelope submission is not implemented yet — wire the envelope call before selecting DOCUMENSO");
}

/** Resolve the active seam: DOCUMENSO only when explicitly selected AND configured. */
export function sealLetter(bytes: Uint8Array | Buffer, now: Date = new Date()): SealResult {
  if (process.env.SIGNING_PROVIDER === "DOCUMENSO") return documensoSeal();
  return hashStamp(bytes, now);
}

/** True when the operator selected the Documenso ceremony layer. */
export function documensoSelected(): boolean {
  return process.env.SIGNING_PROVIDER === "DOCUMENSO";
}

/**
 * Open a signing envelope for an already hash-sealed letter. Async network
 * call — throws fail-closed unless DOCUMENSO is selected AND configured.
 * The hash seal stays the integrity anchor; the envelope is the ceremony.
 */
export async function requestLetterEnvelope(input: {
  title: string;
  fileName: string;
  pdf: Uint8Array | Buffer;
  recipientEmail?: string | null;
  letterId: string;
}): Promise<{ envelopeId: string }> {
  const { documensoConfigFromEnv, requestDocumensoEnvelope } = await import("./documenso");
  const config = documensoConfigFromEnv();
  if (!documensoSelected() || !config) {
    throw new Error("Documenso e-sign is not selected and configured — refusing to open an envelope");
  }
  return requestDocumensoEnvelope(config, {
    title: input.title,
    fileName: input.fileName,
    pdfBase64: Buffer.from(input.pdf).toString("base64"),
    recipientEmail: input.recipientEmail ?? null,
    metadata: { letterId: input.letterId },
  });
}
