/**
 * Extraction quality — pure helpers for OCR confidence gating.
 *
 * The OCR adapter records a per-field confidence (0..1). These helpers turn that
 * number into a decision an operator or a gate can act on, so a low-confidence
 * extraction is FLAGGED rather than silently accepted. Kept pure and
 * dependency-free so both the client portal and the server-side confirm gate
 * share one threshold instead of each hardcoding 0.55.
 */

/** Below this, a field is treated as unreviewed and surfaced for a human check. */
export const LOW_CONFIDENCE_THRESHOLD = 0.55;

export type ExtractionField = {
  fieldKey: string;
  value: string | null;
  confidence: number;
  edited?: boolean;
  source?: string;
};

/**
 * True when a field's value was NOT deliberately confirmed and its confidence is
 * weak. An edited field (or one sourced from a client edit) is authoritative —
 * the human already vouched for it — so it never needs review.
 */
export function fieldNeedsReview(f: Pick<ExtractionField, "confidence" | "edited" | "source">): boolean {
  if (f.edited || f.source === "CLIENT_EDIT") return false;
  return !Number.isFinite(f.confidence) || f.confidence < LOW_CONFIDENCE_THRESHOLD;
}

export type ExtractionReview = {
  total: number;
  /** Keys of fields still needing a human check. */
  lowConfidence: string[];
  /** True when at least one field needs review. */
  needsReview: boolean;
  /** Lowest confidence across the fields (0 when there are none). */
  minConfidence: number;
};

export function extractionReview(fields: readonly ExtractionField[]): ExtractionReview {
  const lowConfidence = fields.filter(fieldNeedsReview).map((f) => f.fieldKey);
  const minConfidence = fields.length === 0 ? 0 : Math.min(...fields.map((f) => f.confidence));
  return { total: fields.length, lowConfidence, needsReview: lowConfidence.length > 0, minConfidence };
}
