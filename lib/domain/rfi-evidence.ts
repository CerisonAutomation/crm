/**
 * RFI answer-with-evidence — pure, Prisma-free helpers (C2 atomic).
 *
 * A client answer may carry evidence: files uploaded through
 * `api.uploadDocument` with the thread's linked `documentRequestId`.
 * The upload links the document to the request; fulfilment itself stays with
 * the staff-side document-request lifecycle (FS-10) — answering never flips
 * a request to FULFILLED. The receipt below is navigational: it travels
 * inside the answer body as `[evidence: …]` lines so staff see what arrived
 * with the answer, and `parseEvidenceRefs` reads them back out.
 *
 * This module MUST NOT import `@/lib/db`, Prisma, react or next — it is
 * imported by client components, routes and unit specs alike.
 */

/** One completed evidence upload attached to an RFI answer (C11 receipt). */
export interface EvidenceReceipt {
  documentId: string;
  fileName: string;
  status: string;
  /** The linked DocumentRequest the file was uploaded against. */
  requestId: string;
  uploadedAt: string;
}

export const EVIDENCE_REF_PREFIX = "[evidence:";

/** One receipt line appended to the answer body — stable, parseable format. */
export function receiptLine(r: EvidenceReceipt): string {
  const name = r.fileName.trim().slice(0, 120) || "document";
  return `${EVIDENCE_REF_PREFIX}${name} (${r.documentId})]`;
}

/**
 * Append receipt lines to the answer body. Blank body with receipts still
 * sends (the evidence IS the answer); blank body without receipts stays
 * blank so the existing min-length validation keeps working unhappy-first.
 */
export function buildAnswerWithEvidence(
  body: string,
  receipts: EvidenceReceipt[]
): string {
  const text = body.trim();
  if (receipts.length === 0) return text;
  const lines = receipts.map(receiptLine);
  return text.length > 0 ? `${text}\n${lines.join("\n")}` : lines.join("\n");
}

/** Read document ids back out of an answer body (receipt lines only). */
export function parseEvidenceRefs(body: string): string[] {
  const out: string[] = [];
  const re = /\[evidence:[^\]]*\(([A-Za-z0-9_-]{1,80})\)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
