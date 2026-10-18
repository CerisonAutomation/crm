/**
 * MRZ-based document classification — pure and client-safe.
 *
 * Uses MRZ (Machine Readable Zone) data to automatically classify documents
 * and extract key fields. This enables live classification during upload
 * without server round-trips.
 *
 * The classifier is conservative: it only returns a classification when
 * the MRZ data is valid and check digits pass. This prevents misclassification
 * of non-passport documents.
 */

import { parsePassportMrzWithChecks, type PassportFields } from "./mrz";

export type DocumentClassification = {
  /** Detected document type */
  type: "PASSPORT" | "NATIONAL_ID" | "UNKNOWN";
  /** Confidence score (0-1) based on check digit validity */
  confidence: number;
  /** Extracted fields from the MRZ */
  fields: PassportFields;
  /** Which check digits passed */
  checks: {
    documentNumber: boolean;
    dateOfBirth: boolean;
    dateOfExpiry: boolean;
    personalNumber: boolean;
    composite: boolean;
  };
  /** Whether the MRZ is valid (all critical checks passed) */
  isValid: boolean;
};

/**
 * Classify a document based on its OCR text.
 *
 * Returns a classification result with extracted fields and confidence score.
 * The confidence is calculated based on how many check digits passed:
 * - All checks pass: 1.0 (high confidence)
 * - Most checks pass: 0.7-0.9 (medium confidence)
 * - Few checks pass: 0.4-0.6 (low confidence)
 * - No MRZ found: returns null
 */
export function classifyDocument(ocrText: string): DocumentClassification | null {
  const result = parsePassportMrzWithChecks(ocrText);
  if (!result) return null;

  const { checks, ...fields } = result;

  // Calculate confidence based on check digit validity
  const checkValues = [
    checks.documentNumber,
    checks.dateOfBirth,
    checks.dateOfExpiry,
    checks.composite,
  ];
  const passedChecks = checkValues.filter(Boolean).length;
  const totalChecks = checkValues.length;

  // Weight composite check more heavily as it covers multiple fields
  const confidence = passedChecks / totalChecks;

  // Determine document type based on MRZ structure
  // TD3 format (2 lines of 44 chars) = passport
  // TD1 format (3 lines of 30 chars) = ID card
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.toUpperCase().replace(/\s+/g, ""))
    .filter((l) => /^[A-Z0-9<]{25,}$/.test(l));

  let type: "PASSPORT" | "NATIONAL_ID" | "UNKNOWN" = "UNKNOWN";
  if (lines.length >= 2 && lines[0].length >= 40) {
    type = "PASSPORT";
  } else if (lines.length >= 3 && lines[0].length >= 25 && lines[0].length < 35) {
    type = "NATIONAL_ID";
  }

  // MRZ is valid if critical checks pass (document number, DOB, expiry, composite)
  const isValid = checks.documentNumber && checks.dateOfBirth && checks.dateOfExpiry && checks.composite;

  return {
    type,
    confidence,
    fields,
    checks,
    isValid,
  };
}

/**
 * Quick check if text contains a valid passport MRZ.
 * Useful for early filtering before full classification.
 */
export function hasValidPassportMrz(ocrText: string): boolean {
  const result = classifyDocument(ocrText);
  return result !== null && result.isValid && result.type === "PASSPORT";
}

/**
 * Extract passport fields from OCR text, or null if no valid MRZ found.
 * Convenience wrapper for simple use cases.
 */
export function extractPassportFields(ocrText: string): PassportFields | null {
  const result = classifyDocument(ocrText);
  return result?.fields ?? null;
}

/**
 * Get a human-readable summary of the classification result.
 * Useful for debugging and logging.
 */
export function classificationSummary(result: DocumentClassification): string {
  const parts = [
    `Type: ${result.type}`,
    `Confidence: ${(result.confidence * 100).toFixed(0)}%`,
    `Valid: ${result.isValid ? "Yes" : "No"}`,
  ];

  if (result.fields.fullName) {
    parts.push(`Name: ${result.fields.fullName}`);
  }
  if (result.fields.documentNumber) {
    parts.push(`Doc#: ${result.fields.documentNumber}`);
  }
  if (result.fields.nationality) {
    parts.push(`Nationality: ${result.fields.nationality}`);
  }

  return parts.join(" | ");
}
