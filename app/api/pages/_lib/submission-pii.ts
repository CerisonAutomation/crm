/**
 * Submission PII redaction helpers for Lane Page submissions.
 *
 * Raw submission JSON can contain applicant PII. Readers outside the desk
 * (e.g. AUDITOR, who holds `page.read`) must not see it; the desk roles
 * (ADMIN, RM, SENIOR_RM) may. Both read paths (page detail + submissions
 * endpoint) route through here so the rule stays in one place.
 */

const RAW_READERS = new Set(["ADMIN", "RM", "SENIOR_RM"]);

export function canReadRawSubmissions(role: string | null | undefined): boolean {
  return !!role && RAW_READERS.has(role);
}

/**
 * Replace the raw submission payload with a redacted marker. Keeps the row's
 * metadata (id, createdAt, status) intact so counts/audit still work.
 */
export function redactSubmissionData(data: unknown): unknown {
  if (data === null || data === undefined) return null;
  return { redacted: true };
}