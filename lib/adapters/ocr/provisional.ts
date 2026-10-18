/**
 * Provisional OCR stage: MRZ candidate building + sealing.
 */

import { MrzCandidate, MrzChecks, MrzFields, ProvisionalResult, OcrQuality } from "./types";

export type ProvisionalProgress = {
  stage: string;
  percent: number;
};

const CHAR_VALUE: Record<string, number> = {};
for (let i = 0; i < 10; i++) CHAR_VALUE[String(i)] = i;
for (let i = 0; i < 26; i++) CHAR_VALUE[String.fromCharCode(65 + i)] = 10 + i;
CHAR_VALUE["<"] = 0;

function checkDigit(str: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const v = CHAR_VALUE[str[i]] ?? 0;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function parseName(line1: string): string {
  // P<UTOERIKSSON<<ANNA<MARIA...
  const body = line1.slice(5); // after P<UTO
  const parts = body.split("<<");
  const surname = (parts[0] || "").replace(/</g, " ").trim();
  const given = (parts[1] || "").replace(/</g, " ").trim();
  return `${given} ${surname}`.trim().replace(/\s+/g, " ").toUpperCase();
}

export function buildMrzCandidate(text: string): MrzCandidate | null {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const line1 = lines[0];
  const line2 = lines[1];
  if (line1.length < 44 || line2.length < 44) return null;
  if (!line1.startsWith("P")) return null;

  const docNumber = line2.slice(0, 9);
  const docCheck = line2[9];
  const nationality = line2.slice(10, 13);
  const dob = line2.slice(13, 19);
  const dobCheck = line2[19];
  const sex = line2[20];
  const expiry = line2.slice(21, 27);
  const expiryCheck = line2[27];
  const personal = line2.slice(28, 42);
  const personalCheck = line2[42];
  const composite = line2.slice(43, 44);

  const checks: MrzChecks = {
    documentNumber: checkDigit(docNumber) === Number(docCheck),
    dateOfBirth: checkDigit(dob) === Number(dobCheck),
    dateOfExpiry: checkDigit(expiry) === Number(expiryCheck),
    composite:
      checkDigit(docNumber + docCheck + nationality + dob + dobCheck + sex + expiry + expiryCheck + personal + personalCheck) ===
      Number(composite),
  };

  const isValid = checks.documentNumber && checks.dateOfBirth && checks.dateOfExpiry && checks.composite;

  const fields: MrzFields = {
    fullName: parseName(line1),
    documentNumber: docNumber.replace(/</g, "").trim(),
    nationality,
    dateOfBirth: dob,
    dateOfExpiry: expiry,
  };

  return { checks, isValid, fields, line1, line2 };
}

export function sealProvisional(input: { text: string; confidence: number; mrz: MrzCandidate | null }): ProvisionalResult {
  return {
    stage: "provisional",
    autoApproved: false,
    needsHumanReview: true,
    text: input.text,
    confidence: input.confidence,
    quality: input.confidence >= 0.9 ? "excellent" : input.confidence >= 0.75 ? "good" : input.confidence >= 0.5 ? "fair" : "poor",
    model: "provisional",
    createdAt: new Date().toISOString(),
    mrz: input.mrz,
  };
}
