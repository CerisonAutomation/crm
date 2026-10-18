/**
 * OCR adapter shared types + the FS-9 human gate (four-eyes).
 */

export type OcrQuality = "poor" | "fair" | "good" | "excellent";

export const PROVISIONAL_DISCLAIMER =
  "Provisional OCR result — never auto-approved; requires human review.";

export function qualityFromConfidence(confidence: number, charCount: number): OcrQuality {
  if (charCount < 50) return "poor";
  if (confidence >= 0.9) return "excellent";
  if (confidence >= 0.75) return "good";
  if (confidence >= 0.5) return "fair";
  return "poor";
}

export type HumanGateInput = {
  actorId: string;
  uploaderId: string;
  decision: "APPROVED" | "REJECTED" | "RENEW" | "REQUEST_CHANGES";
  reason: string | null;
};

export type HumanGateResult = { ok: true } | { ok: false; status: number; message: string };

export function assertHumanGate(input: HumanGateInput): HumanGateResult {
  if (!input.actorId || !input.uploaderId) {
    return { ok: false, status: 400, message: "actor and uploader ids are required" };
  }
  if (input.actorId === input.uploaderId) {
    return { ok: false, status: 403, message: "self-approval forbidden" };
  }
  const needsReason = input.decision !== "APPROVED";
  if (needsReason && (!input.reason || !input.reason.trim())) {
    return { ok: false, status: 400, message: "reason required" };
  }
  return { ok: true };
}

// MRZ candidate types
export type MrzChecks = {
  documentNumber: boolean;
  dateOfBirth: boolean;
  dateOfExpiry: boolean;
  composite: boolean;
};

export type MrzFields = {
  fullName: string;
  documentNumber: string;
  nationality: string;
  dateOfBirth: string;
  dateOfExpiry: string;
};

export type MrzCandidate = {
  checks: MrzChecks;
  isValid: boolean;
  fields: MrzFields;
  line1: string;
  line2: string;
};

export type ProvisionalResult = {
  stage: "provisional";
  autoApproved: false;
  needsHumanReview: true;
  text: string;
  confidence: number;
  quality: OcrQuality;
  model: string;
  createdAt: string;
  mrz: MrzCandidate | null;
};

export type AuthoritativeMrz = MrzCandidate | null;
