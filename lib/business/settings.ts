/**
 * Business settings — server-side load/merge/validate pipeline for
 * /api/settings/business.
 *
 * Storage: the configuration lives in the org's EXISTING, org-scoped
 * `BrandSetting` row under `extras.business` (BrandSetting.extras is documented
 * as free-form future tokens) — so no dedicated table and no migration. The
 * public GET /api/brand strips `extras`, so this config stays server-side.
 *
 * Precedence (documented for every consumer):
 *   stored value (BrandSetting.extras.business, deep-merged per section)
 *     > canon default (src/lib/business/defaults.ts).
 * Absence of the row — or of any key — always falls back to canon, so the app
 * and every generated PDF render with zero configuration.
 */
import { db } from "@/lib/db";
import {
  DEFAULT_BUSINESS,
  LETTER_KINDS,
  deepMergeBusiness,
  type BusinessConfig,
  type LetterKind,
} from "@/lib/business/defaults";
import { DomainError } from "@/lib/domain/states";

// ── Load (server) ───────────────────────────────────────────────────────────

/** The key under BrandSetting.extras that holds the business configuration. */
const EXTRAS_KEY = "business";

/** Parse a JSON string column (or pass through an object) defensively. */
function parseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * Load the merged business settings. A missing row/key — or any Prisma error —
 * falls back to canon rather than crashing routes or letter rendering.
 */
export async function loadBusinessSettings(): Promise<BusinessConfig & { updatedAt?: string }> {
  let row: { extras: string; updatedAt: Date } | null;
  try {
    row = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  } catch {
    return { ...DEFAULT_BUSINESS };
  }
  if (!row) return { ...DEFAULT_BUSINESS };
  const extras = parseObject(row.extras);
  const merged = deepMergeBusiness(DEFAULT_BUSINESS, extras[EXTRAS_KEY]);
  return { ...merged, updatedAt: row.updatedAt.toISOString() };
}

// ── Validation ──────────────────────────────────────────────────────────────

const MAX_AMOUNT = 1_000_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new DomainError(`${field} must be a string`, 400);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new DomainError(`${field} exceeds ${max} characters`, 400);
  return trimmed;
}

function asAmount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    throw new DomainError(`${field} must be a finite number between 0 and ${MAX_AMOUNT}`, 400);
  }
  return n;
}

/** Validate a keyed string section (unknown keys rejected, each length-capped). */
function strSection(
  input: unknown,
  fields: Record<string, number>,
  label: string,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) throw new DomainError(`${label} must be an object`, 400);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(key in fields)) throw new DomainError(`Unknown ${label} field "${key}"`, 400);
    const v = asStr(value, `${label}.${key}`, fields[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export type ValidatedFirm = Partial<Record<keyof BusinessConfig["firm"], string>>;
export type ValidatedFees = {
  currency?: string;
  defaultProfessional?: number;
  perProgramme?: Record<string, number>;
  professionalLineLabel?: string;
  governmentLineLabel?: string;
  disbursementsLineLabel?: string;
  terms?: string[];
};
export type ValidatedLetters = {
  subjects?: Partial<Record<LetterKind, string>>;
  issuerRoles?: Record<string, string>;
};
export type ValidatedBusinessPatch = {
  firm?: ValidatedFirm;
  fees?: ValidatedFees;
  letters?: ValidatedLetters;
};

/**
 * Validate a PUT body into a safe per-section patch. Unknown keys rejected,
 * every string length-capped, every amount a finite non-negative number,
 * collection sizes bounded (no free-form-input discipline).
 */
export function validateBusinessPatch(body: unknown): ValidatedBusinessPatch {
  if (!isPlainObject(body)) {
    throw new DomainError("Expected a JSON object with business sections", 400);
  }
  const allowed = ["firm", "fees", "letters"];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new DomainError(`Unknown business section "${key}"`, 400);
  }

  const firm = strSection(
    body.firm,
    { legalName: 200, place: 200, closing: 200, signOff: 200, confidentiality: 200 },
    "firm",
  );

  let fees: ValidatedFees | undefined;
  if (body.fees !== undefined) {
    if (!isPlainObject(body.fees)) throw new DomainError("fees must be an object", 400);
    const f = body.fees;
    const feeFields = [
      "currency", "defaultProfessional", "perProgramme",
      "professionalLineLabel", "governmentLineLabel", "disbursementsLineLabel", "terms",
    ];
    for (const key of Object.keys(f)) {
      if (!feeFields.includes(key)) throw new DomainError(`Unknown fees field "${key}"`, 400);
    }
    fees = {};
    const currency = asStr(f.currency, "fees.currency", 8);
    if (currency !== undefined) fees.currency = currency;
    const dp = asAmount(f.defaultProfessional, "fees.defaultProfessional");
    if (dp !== undefined) fees.defaultProfessional = dp;
    if (f.perProgramme !== undefined) {
      if (!isPlainObject(f.perProgramme)) throw new DomainError("fees.perProgramme must be an object", 400);
      const entries = Object.entries(f.perProgramme);
      if (entries.length > 50) throw new DomainError("fees.perProgramme has at most 50 entries", 400);
      const out: Record<string, number> = {};
      for (const [key, value] of entries) {
        if (key.length > 40) throw new DomainError(`fees.perProgramme key "${key}" exceeds 40 characters`, 400);
        out[key] = asAmount(value, `fees.perProgramme.${key}`)!;
      }
      fees.perProgramme = out;
    }
    const pll = asStr(f.professionalLineLabel, "fees.professionalLineLabel", 400);
    if (pll !== undefined) fees.professionalLineLabel = pll;
    const gll = asStr(f.governmentLineLabel, "fees.governmentLineLabel", 400);
    if (gll !== undefined) fees.governmentLineLabel = gll;
    const dll = asStr(f.disbursementsLineLabel, "fees.disbursementsLineLabel", 400);
    if (dll !== undefined) fees.disbursementsLineLabel = dll;
    if (f.terms !== undefined) {
      if (!Array.isArray(f.terms)) throw new DomainError("fees.terms must be an array", 400);
      if (f.terms.length > 12) throw new DomainError("fees.terms has at most 12 items", 400);
      fees.terms = f.terms.map((t, i) => asStr(t, `fees.terms[${i}]`, 800)!);
    }
  }

  let letters: ValidatedLetters | undefined;
  if (body.letters !== undefined) {
    if (!isPlainObject(body.letters)) throw new DomainError("letters must be an object", 400);
    const l = body.letters;
    for (const key of Object.keys(l)) {
      if (key !== "subjects" && key !== "issuerRoles") {
        throw new DomainError(`Unknown letters field "${key}"`, 400);
      }
    }
    letters = {};
    if (l.subjects !== undefined) {
      if (!isPlainObject(l.subjects)) throw new DomainError("letters.subjects must be an object", 400);
      const kinds = new Set<string>(LETTER_KINDS);
      const subjects: Partial<Record<LetterKind, string>> = {};
      for (const [key, value] of Object.entries(l.subjects)) {
        if (!kinds.has(key)) throw new DomainError(`Unknown letter subject "${key}"`, 400);
        subjects[key as LetterKind] = asStr(value, `letters.subjects.${key}`, 200)!;
      }
      letters.subjects = subjects;
    }
    if (l.issuerRoles !== undefined) {
      if (!isPlainObject(l.issuerRoles)) throw new DomainError("letters.issuerRoles must be an object", 400);
      const entries = Object.entries(l.issuerRoles);
      if (entries.length > 20) throw new DomainError("letters.issuerRoles has at most 20 entries", 400);
      const issuerRoles: Record<string, string> = {};
      for (const [key, value] of entries) {
        if (key.length > 40) throw new DomainError(`letters.issuerRoles key "${key}" exceeds 40 characters`, 400);
        issuerRoles[key] = asStr(value, `letters.issuerRoles.${key}`, 80)!;
      }
      letters.issuerRoles = issuerRoles;
    }
  }

  return { firm, fees, letters };
}

// ── Persist (deep-merged row) ───────────────────────────────────────────────

/**
 * Apply a validated patch onto the current merged settings and persist the
 * WHOLE merged config into the org's BrandSetting row under extras.business
 * (so what is stored is always a complete, self-contained snapshot; canon
 * still reasserts on reset). Any other extras keys and all brand columns are
 * preserved untouched.
 */
export async function saveBusinessSettings(
  orgId: string,
  patch: ValidatedBusinessPatch,
): Promise<BusinessConfig & { updatedAt: string }> {
  const current = await loadBusinessSettings();
  const next: BusinessConfig = {
    firm: patch.firm ? deepMergeBusiness(current.firm, patch.firm) : current.firm,
    fees: patch.fees ? deepMergeBusiness(current.fees, patch.fees) : current.fees,
    letters: patch.letters ? deepMergeBusiness(current.letters, patch.letters) : current.letters,
  };

  const existing = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  const extras = { ...parseObject(existing?.extras), [EXTRAS_KEY]: next };
  const brand = {
    tokens: existing?.tokens ?? "{}",
    wordmark: existing?.wordmark ?? "{}",
    slogan: existing?.slogan ?? "",
    contact: existing?.contact ?? "{}",
    hero: existing?.hero ?? "{}",
    logo: existing?.logo ?? "{}",
  };

  const row = await db.brandSetting.upsert({
    where: { orgId },
    update: { ...brand, extras: JSON.stringify(extras) },
    create: { orgId, ...brand, extras: JSON.stringify(extras) },
  });

  return { ...next, updatedAt: row.updatedAt.toISOString() };
}

/** Revert the business settings to canon (the extras.business key is removed). */
export async function resetBusinessSettings(orgId: string): Promise<{ count: number }> {
  const row = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!row) return { count: 0 };
  const extras = parseObject(row.extras);
  delete extras[EXTRAS_KEY];
  await db.brandSetting.update({ where: { id: row.id }, data: { extras: JSON.stringify(extras) } });
  return { count: 1 };
}
