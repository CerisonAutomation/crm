/**
 * OCR retention stamping.
 */
export type OcrRetention = {
  basis: string;
  days: number | null;
  purgeAfter: Date | null;
  legalHold: boolean;
};

export function ocrRetention(now: Date): OcrRetention {
  // Default: 7-year retention window (common for KYC/AML records).
  const days = 7 * 365;
  const purgeAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    basis: "KYC/AML record retention (7 years)",
    days,
    purgeAfter,
    legalHold: false,
  };
}
