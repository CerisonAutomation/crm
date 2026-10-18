/**
 * Citizen Lane — CANON business defaults (single source of truth).
 *
 * This module is the ONLY home of the firm's canonical firm/letter/fee copy.
 * It is deliberately client-safe (no server imports): the admin "Brand &
 * Business" surface, the letter templates and the API all consume these types.
 * A stored override (BrandSetting.extras.business — see
 * src/lib/business/settings.ts) merges over this canon section by section —
 * absence of the row (or of any key) always falls back to canon, so the app
 * and every generated PDF render identically to the day before this settings
 * surface existed, with zero configuration.
 *
 * The values below reproduce the previously-hardcoded strings byte-for-byte
 * (letter-data.ts LETTER_PLACE/LETTER_SUBJECTS/PROFESSIONAL_FEE, the letterhead
 * header/footer copy and the engagement/receipt fee schedule).
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type BusinessFirm = {
  legalName: string;
  place: string;
  closing: string;
  signOff: string;
  confidentiality: string;
};

export type BusinessFees = {
  currency: string;
  defaultProfessional: number;
  /** Professional engagement fee per programme key (falls back to defaultProfessional). */
  perProgramme: Record<string, number>;
  professionalLineLabel: string;
  /** Contains the `{programme}` token — replaced with the programme's authority charges. */
  governmentLineLabel: string;
  disbursementsLineLabel: string;
  terms: string[];
};

export const LETTER_KINDS = [
  "APPROVAL_IN_PRINCIPLE",
  "FINAL_APPROVAL",
  "DOCUMENT_REQUEST",
  "ENGAGEMENT_FEE_PROPOSAL",
  "PAYMENT_RECEIPT",
] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export type BusinessLetters = {
  /** Subject line template per letter kind — contains the `{ref}` token. */
  subjects: Record<LetterKind, string>;
  /** Signature-block role label per role code (RM / SENIOR_RM / ADMIN). */
  issuerRoles: Record<string, string>;
};

/** The fully-merged business settings shape the app and templates consume. */
export type BusinessConfig = {
  firm: BusinessFirm;
  fees: BusinessFees;
  letters: BusinessLetters;
};

// ── Canon values ────────────────────────────────────────────────────────────

export const DEFAULT_BUSINESS: BusinessConfig = {
  firm: {
    legalName: "Citizen Lane GmbH",
    place: "Zurich",
    closing: "Yours sincerely,",
    signOff: "Citizen Lane GmbH · Relationship Management",
    confidentiality: "STRICTLY CONFIDENTIAL — FOR THE NAMED ADDRESSEE ONLY",
  },
  fees: {
    currency: "CHF",
    defaultProfessional: 9800,
    perProgramme: {
      DE_BUSINESS: 12500,
      AT_RESIDENCE: 9800,
      MT_CITIZENSHIP: 24500,
    },
    professionalLineLabel:
      "Professional engagement fee — case management, dossier preparation and representation",
    governmentLineLabel: "Government fees — {programme} (passed through at cost)",
    disbursementsLineLabel:
      "Disbursements — apostilles, certified translations and courier dispatch",
    terms: [
      "The engagement commences upon the client's written acceptance of this proposal; the professional engagement fee is invoiced with the countersigned engagement letter.",
      "Government fees and disbursements are invoiced at cost as they fall due, supported by receipts.",
      "Fees are quoted in Swiss francs (CHF) and are exclusive of any bank charges on inbound transfers.",
      "This proposal is valid for 30 days from its date. Citizen Lane GmbH, Zurich — 2026 schedule.",
    ],
  },
  letters: {
    subjects: {
      APPROVAL_IN_PRINCIPLE: "Approval in Principle — Application {ref}",
      FINAL_APPROVAL: "Final Approval — Application {ref}",
      DOCUMENT_REQUEST: "Request for Documents — Application {ref}",
      ENGAGEMENT_FEE_PROPOSAL: "Engagement & Fee Proposal — Application {ref}",
      PAYMENT_RECEIPT: "Payment Receipt — Application {ref}",
    },
    issuerRoles: {
      RM: "Relationship Manager",
      SENIOR_RM: "Senior Relationship Manager",
      ADMIN: "Administration",
    },
  },
};

// ── Deep per-section merge (DB row over canon) ──────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge `patch` over `base` per section. Objects merge key-wise (missing keys
 * fall back to base); arrays and primitives replace wholesale; `undefined`
 * values are skipped. Used by the business settings API (server-authoritative)
 * and defensively by the admin surface.
 */
export function deepMergeBusiness<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  if (!isPlainObject(base)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMergeBusiness(current, value) : value;
  }
  return out as T;
}
