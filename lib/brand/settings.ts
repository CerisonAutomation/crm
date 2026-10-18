/**
 * Brand settings — server-side load/merge/validate pipeline for /api/brand.
 *
 * Precedence (documented for every consumer):
 *   user setting (BrandSetting DB row, deep-merged per section)
 *     > canon default (src/lib/brand/defaults.ts).
 * i18n keeps translating UI LABELS only — brand COPY (wordmark, slogan,
 * contact, hero) is data, not translation: wherever a settings value
 * exists it renders verbatim; when a section is absent the canon default
 * renders. Brand copy is never routed through the i18n dictionaries.
 */
import { db } from "@/lib/db";
import {
  CANON_BRAND,
  deepMergeBrand,
  type CanonBrand,
} from "@/lib/brand/defaults";
import { DomainError } from "@/lib/domain/states";

// ── Load (server) ───────────────────────────────────────────────────────────

/** Parse a JSON string column defensively (corrupt rows fall back to canon). */
function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Load the merged brand settings for an org (or the platform singleton —
 * the sandbox runs a single org). Absence of the row → pure canon.
 */
export async function loadBrandSettings(): Promise<CanonBrand & { updatedAt?: string }> {
  const row = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!row) return { ...CANON_BRAND };
  const merged = deepMergeBrand(CANON_BRAND, {
    tokens: parseJson(row.tokens),
    wordmark: parseJson(row.wordmark),
    slogan: row.slogan || undefined,
    contact: parseJson(row.contact),
    hero: parseJson(row.hero),
    logo: parseJson(row.logo),
    extras: parseJson(row.extras),
  });
  return { ...merged, updatedAt: row.updatedAt.toISOString() };
}

// ── Validation ──────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function asHex(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    throw new DomainError(`Invalid colour for ${field}: expected 6-digit hex like #B08C52`, 400);
  }
  return value.toLowerCase();
}

function asStr(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new DomainError(`${field} must be a string`, 400);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new DomainError(`${field} exceeds ${max} characters`, 400);
  return trimmed;
}

/** Validate one hex-typed section key-by-key (unknown keys rejected). */
function hexSection(
  input: unknown,
  fields: readonly string[],
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DomainError("Expected an object of hex colours", 400);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!fields.includes(key)) throw new DomainError(`Unknown token "${key}"`, 400);
    const hex = asHex(value, key);
    if (hex !== undefined) out[key] = hex;
  }
  return out;
}

function strSection(
  input: unknown,
  fields: Record<string, number>,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DomainError("Expected an object of strings", 400);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(key in fields)) throw new DomainError(`Unknown field "${key}"`, 400);
    const v = asStr(value, key, fields[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export type ValidatedBrandPatch = {
  tokens: Record<string, unknown> | undefined;
  wordmark: Record<string, string> | undefined;
  slogan: string | undefined;
  contact: Record<string, string> | undefined;
  hero: Record<string, string> | undefined;
  logo: Record<string, unknown> | undefined;
  extras: Record<string, unknown> | undefined;
};

/**
 * Validate a PUT body into a safe per-section patch. Every hex is regex
 * checked, every string length-capped, unknown keys rejected (bounded,
 * no-free-form-input discipline).
 */
export function validateBrandPatch(body: unknown): ValidatedBrandPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("Expected a JSON object with brand sections", 400);
  }
  const b = body as Record<string, unknown>;
  const allowed = ["tokens", "wordmark", "slogan", "contact", "hero", "logo", "extras"];
  for (const key of Object.keys(b)) {
    if (!allowed.includes(key)) throw new DomainError(`Unknown brand section "${key}"`, 400);
  }

  // tokens: core hexes + optional secondary palette + chrome hexes
  let tokens: Record<string, unknown> | undefined;
  if (b.tokens !== undefined) {
    if (typeof b.tokens !== "object" || b.tokens === null || Array.isArray(b.tokens)) {
      throw new DomainError("tokens must be an object", 400);
    }
    const t = { ...(b.tokens as Record<string, unknown>) };
    const core = hexSection(
      {
        gold: t.gold,
        sky: t.sky,
        iron: t.iron,
        limestone: t.limestone,
        cobble: t.cobble,
        paper: t.paper,
        plaster: t.plaster,
      },
      ["gold", "sky", "iron", "limestone", "cobble", "paper", "plaster"],
    );
    const chrome = hexSection(
      t.chrome,
      ["bg", "border", "text", "textDim", "active", "hover"],
    );
    let secondary: string[] | undefined;
    if (t.secondary !== undefined) {
      if (!Array.isArray(t.secondary) || t.secondary.length > 12) {
        throw new DomainError("tokens.secondary must be an array of at most 12 hexes", 400);
      }
      secondary = (t.secondary as unknown[]).map((h, i) => asHex(h, `secondary[${i}]`)!);
    }
    tokens = {};
    if (core) tokens.core = core;
    if (chrome) tokens.chrome = chrome;
    if (secondary) tokens.secondary = secondary;
  }

  const wordmark = strSection(b.wordmark, { title: 60, tagline: 120 });
  const slogan = asStr(b.slogan, "slogan", 90);
  const contact = strSection(b.contact, { city: 80, email: 120, phone: 40, site: 120 });
  const hero = strSection(b.hero, {
    eyebrow: 90,
    headline: 180,
    subtext: 500,
    ctaPrimary: 60,
    ctaSecondary: 60,
  });

  let logo: Record<string, unknown> | undefined;
  if (b.logo !== undefined) {
    if (typeof b.logo !== "object" || b.logo === null || Array.isArray(b.logo)) {
      throw new DomainError("logo must be an object", 400);
    }
    const l = b.logo as Record<string, unknown>;
    logo = {};
    if (l.markColor !== undefined) logo.markColor = asHex(l.markColor, "logo.markColor");
    if (l.monogramColor !== undefined) logo.monogramColor = asHex(l.monogramColor, "logo.monogramColor");
    if (l.panelFill !== undefined) logo.panelFill = asHex(l.panelFill, "logo.panelFill");
    if (l.panelOpacity !== undefined) {
      const op = Number(l.panelOpacity);
      if (!Number.isFinite(op) || op < 0 || op > 1) {
        throw new DomainError("logo.panelOpacity must be a number between 0 and 1", 400);
      }
      logo.panelOpacity = op;
    }
    if (l.darkTagline !== undefined) {
      if (l.darkTagline !== "cream" && l.darkTagline !== "gold") {
        throw new DomainError("logo.darkTagline must be \"cream\" or \"gold\"", 400);
      }
      logo.darkTagline = l.darkTagline;
    }
  }

  let extras: Record<string, unknown> | undefined;
  if (b.extras !== undefined) {
    if (typeof b.extras !== "object" || b.extras === null || Array.isArray(b.extras)) {
      throw new DomainError("extras must be a JSON object", 400);
    }
    extras = b.extras as Record<string, unknown>;
    if (JSON.stringify(extras).length > 4000) {
      throw new DomainError("extras exceeds 4000 characters", 400);
    }
  }

  return { tokens, wordmark, slogan, contact, hero, logo, extras };
}

// ── Persist (deep-merged row) ───────────────────────────────────────────────

/**
 * Apply a validated patch onto the current merged settings and persist the
 * WHOLE merged sections as the DB row (so the row is always a complete,
 * self-contained snapshot; canon still reasserts on reset).
 */
export async function saveBrandSettings(
  orgId: string,
  patch: ValidatedBrandPatch,
): Promise<CanonBrand & { updatedAt: string }> {
  const current = await loadBrandSettings();

  // tokens is stored flattened: core keys + chrome{} + secondary[]
  const currentTokens = current.tokens as Record<string, unknown>;
  const nextTokens = { ...currentTokens };
  if (patch.tokens?.core) Object.assign(nextTokens, patch.tokens.core);
  if (patch.tokens?.chrome) nextTokens.chrome = deepMergeBrand(currentTokens.chrome, patch.tokens.chrome);
  if (patch.tokens?.secondary) nextTokens.secondary = patch.tokens.secondary;

  const next = {
    tokens: nextTokens,
    wordmark: patch.wordmark ? deepMergeBrand(current.wordmark, patch.wordmark) : current.wordmark,
    slogan: patch.slogan ?? current.slogan,
    contact: patch.contact ? deepMergeBrand(current.contact, patch.contact) : current.contact,
    hero: patch.hero ? deepMergeBrand(current.hero, patch.hero) : current.hero,
    logo: patch.logo ? deepMergeBrand(current.logo, patch.logo) : current.logo,
    extras: patch.extras ? deepMergeBrand(current.extras, patch.extras) : current.extras,
  };

  const row = await db.brandSetting.upsert({
    where: { orgId },
    update: {
      tokens: JSON.stringify(next.tokens),
      wordmark: JSON.stringify(next.wordmark),
      slogan: next.slogan,
      contact: JSON.stringify(next.contact),
      hero: JSON.stringify(next.hero),
      logo: JSON.stringify(next.logo),
      extras: JSON.stringify(next.extras ?? {}),
    },
    create: {
      orgId,
      tokens: JSON.stringify(next.tokens),
      wordmark: JSON.stringify(next.wordmark),
      slogan: next.slogan,
      contact: JSON.stringify(next.contact),
      hero: JSON.stringify(next.hero),
      logo: JSON.stringify(next.logo),
      extras: JSON.stringify(next.extras ?? {}),
    },
  });

  return { ...(deepMergeBrand(CANON_BRAND, {
    tokens: parseJson(row.tokens),
    wordmark: parseJson(row.wordmark),
    slogan: row.slogan || undefined,
    contact: parseJson(row.contact),
    hero: parseJson(row.hero),
    logo: parseJson(row.logo),
    extras: parseJson(row.extras),
  }) as CanonBrand), updatedAt: row.updatedAt.toISOString() };
}
