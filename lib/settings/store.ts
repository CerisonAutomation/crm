/**
 * Platform settings store — server-side load/validate/persist pipeline for the
 * registry-driven /api/settings surface.
 *
 * Storage: the configuration lives in the org's EXISTING, org-scoped
 * `BrandSetting` row under `extras.platform`, alongside `extras.business`
 * (see src/lib/business/settings.ts — this mirrors its parseObject approach).
 * No dedicated table, no migration. Every write persists the WHOLE merged
 * platform snapshot while spreading the existing extras, so `extras.business`
 * and every other extras key are preserved untouched.
 *
 * Precedence (documented for every consumer):
 *   stored value (BrandSetting.extras.platform, merged over canon per section)
 *     > canon default (src/lib/settings/registry.ts).
 * A missing row/key — or any Prisma error — always falls back to canon, so the
 * app and every generated PDF render with zero configuration.
 */
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";
import {
  DEFAULT_PLATFORM_SETTINGS,
  findSettingsSection,
  mergePlatformSettings,
  type PlatformSettings,
  type SettingsField,
} from "./registry";

/** The key under BrandSetting.extras that holds the platform configuration. */
const EXTRAS_KEY = "platform";

/** Boundary caps (see the registry field types). */
const MAX_STRING = 120;
const MAX_ITEMS = 50;
const MIN_WEEK = 1;
const MAX_WEEK = 52;

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Load (server) ───────────────────────────────────────────────────────────

/**
 * Load the merged platform settings. A missing row/key — or any Prisma error —
 * falls back to canon rather than crashing routes or letter rendering.
 */
export async function loadPlatformSettings(): Promise<PlatformSettings> {
  let row: { extras: string } | null = null;
  try {
    row = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  } catch {
    return mergePlatformSettings(undefined);
  }
  if (!row) return mergePlatformSettings(undefined);
  return mergePlatformSettings(parseObject(row.extras)[EXTRAS_KEY]);
}

// ── Validation ──────────────────────────────────────────────────────────────

export type ValidatedSectionPatch = Record<
  string,
  string | number | string[] | number[] | Record<string, string> | Record<string, number>
>;

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new DomainError(`${field} must be a string`, 400);
  const trimmed = value.trim();
  if (trimmed.length > MAX_STRING) throw new DomainError(`${field} exceeds ${MAX_STRING} characters`, 400);
  return trimmed;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new DomainError(`${field} must be an array`, 400);
  if (value.length > MAX_ITEMS) throw new DomainError(`${field} has at most ${MAX_ITEMS} items`, 400);
  return value.map((item, i) => asString(item, `${field}[${i}]`));
}

function asWeekArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new DomainError(`${field} must be an array`, 400);
  if (value.length > MAX_ITEMS) throw new DomainError(`${field} has at most ${MAX_ITEMS} items`, 400);
  return value.map((item, i) => {
    const n = typeof item === "number" ? item : Number(item);
    if (!Number.isInteger(n) || n < MIN_WEEK || n > MAX_WEEK) {
      throw new DomainError(`${field}[${i}] must be an integer between ${MIN_WEEK} and ${MAX_WEEK}`, 400);
    }
    return n;
  });
}

function asInteger(value: unknown, field: string, min?: number, max?: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new DomainError(`${field} must be a finite number`, 400);
  if (!Number.isInteger(n)) throw new DomainError(`${field} must be an integer`, 400);
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  if (n < lo || n > hi) throw new DomainError(`${field} must be an integer between ${lo} and ${hi}`, 400);
  return n;
}

/**
 * Validate a keyed map of integers against the canon key set. Same key rule as
 * `asStringMap`: an unknown key is rejected rather than stored, since the domain
 * only ever looks up canon stage keys. Every value is bounded by the field's
 * min/max so a stored 0 or 99999 cannot silently disable or absurdly extend a
 * service level.
 */
function asNumberMap(value: unknown, field: string, canonKeys: string[], min?: number, max?: number): Record<string, number> {
  if (!isPlainObject(value)) throw new DomainError(`${field} must be an object`, 400);
  const entries = Object.entries(value);
  if (entries.length > MAX_ITEMS) throw new DomainError(`${field} has at most ${MAX_ITEMS} entries`, 400);
  const allowed = new Set(canonKeys);
  const out: Record<string, number> = {};
  for (const [key, raw] of entries) {
    if (!allowed.has(key)) throw new DomainError(`Unknown ${field} key "${key}"`, 400);
    out[key] = asInteger(raw, `${field}.${key}`, min, max);
  }
  return out;
}

function asStringMap(value: unknown, field: string, canonKeys: string[]): Record<string, string> {
  if (!isPlainObject(value)) throw new DomainError(`${field} must be an object`, 400);
  const entries = Object.entries(value);
  if (entries.length > MAX_ITEMS) throw new DomainError(`${field} has at most ${MAX_ITEMS} entries`, 400);
  const allowed = new Set(canonKeys);
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!allowed.has(key)) throw new DomainError(`Unknown ${field} key "${key}"`, 400);
    out[key] = asString(raw, `${field}.${key}`);
  }
  return out;
}

/** Canon default value for one field (used to derive the allowed map keys). */
function canonFieldValue(sectionKey: string, fieldKey: string): unknown {
  const section = (DEFAULT_PLATFORM_SETTINGS as unknown as Record<string, Record<string, unknown>>)[sectionKey];
  return section?.[fieldKey];
}

function validateField(sectionKey: string, field: SettingsField, value: unknown): ValidatedSectionPatch[string] {
  const label = `${sectionKey}.${field.key}`;
  switch (field.type) {
    case "string": {
      const s = asString(value, label);
      // A field may declare a regex the value must match (e.g. the quiet-hours
      // window). Enforced here so a malformed value is rejected at the boundary
      // rather than stored and silently ignored by every consumer.
      if (field.pattern && !new RegExp(field.pattern).test(s)) {
        throw new DomainError(`${label} must match ${field.pattern}`, 400);
      }
      return s;
    }
    case "string[]":
      return asStringArray(value, label);
    case "number":
      return asInteger(value, label, field.min, field.max);
    case "number[]":
      return asWeekArray(value, label);
    case "stringMap": {
      const canon = canonFieldValue(sectionKey, field.key);
      const keys = isPlainObject(canon) ? Object.keys(canon) : [];
      return asStringMap(value, label, keys);
    }
    case "numberMap": {
      const canon = canonFieldValue(sectionKey, field.key);
      const keys = isPlainObject(canon) ? Object.keys(canon) : [];
      return asNumberMap(value, label, keys, field.min, field.max);
    }
  }
}

/**
 * Validate a PUT body into a safe per-section patch. Unknown sections and
 * unknown keys are rejected; strings are capped at 120 chars, arrays at 50
 * items, records at 50 entries and week numbers to integers 1–52.
 */
export function validateSectionPatch(section: string, body: unknown): ValidatedSectionPatch {
  const def = findSettingsSection(section);
  if (!def) throw new DomainError(`Unknown settings section "${section}"`, 400);
  if (!isPlainObject(body)) throw new DomainError("Expected a JSON object", 400);

  const allowed = new Set(def.fields.map((f) => f.key));
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new DomainError(`Unknown ${section} field "${key}"`, 400);
  }

  const out: ValidatedSectionPatch = {};
  for (const field of def.fields) {
    const value = body[field.key];
    if (value === undefined) continue;
    out[field.key] = validateField(def.key, field, value);
  }
  return out;
}

// ── Persist (whole-section snapshot) ────────────────────────────────────────

const brandColumns = (existing: {
  tokens: string; wordmark: string; slogan: string; contact: string; hero: string; logo: string;
} | null) => ({
  tokens: existing?.tokens ?? "{}",
  wordmark: existing?.wordmark ?? "{}",
  slogan: existing?.slogan ?? "",
  contact: existing?.contact ?? "{}",
  hero: existing?.hero ?? "{}",
  logo: existing?.logo ?? "{}",
});

/**
 * Apply a validated patch onto the current merged settings and persist the
 * WHOLE merged section snapshot into the org's BrandSetting row under
 * extras.platform (a complete, self-contained snapshot; canon still reasserts
 * on reset). Every other extras key — including extras.business — and all brand
 * columns are preserved untouched.
 */
export async function savePlatformSettingsSection(
  orgId: string,
  section: string,
  patch: ValidatedSectionPatch,
): Promise<PlatformSettings> {
  const def = findSettingsSection(section);
  if (!def) throw new DomainError(`Unknown settings section "${section}"`, 400);

  const current = await loadPlatformSettings();
  const nextSection: Record<string, unknown> = {
    ...(current[def.key] as unknown as Record<string, unknown>),
    ...patch,
  };

  const existing = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  const extras = parseObject(existing?.extras);
  const platform: Record<string, unknown> = { ...parseObject(extras[EXTRAS_KEY]), [def.key]: nextSection };
  const nextExtras = { ...extras, [EXTRAS_KEY]: platform };

  await db.brandSetting.upsert({
    where: { orgId },
    update: { ...brandColumns(existing), extras: JSON.stringify(nextExtras) },
    create: { orgId, ...brandColumns(existing), extras: JSON.stringify(nextExtras) },
  });

  return mergePlatformSettings(platform);
}

/**
 * Revert a single section to canon (the extras.platform[section] key is
 * removed); when the platform key becomes empty it is dropped too. The
 * extras.business key and every other extras key are preserved.
 */
export async function resetPlatformSettingsSection(orgId: string, section: string): Promise<PlatformSettings> {
  const def = findSettingsSection(section);
  if (!def) throw new DomainError(`Unknown settings section "${section}"`, 400);

  const row = await db.brandSetting.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!row) return mergePlatformSettings(undefined);

  const extras = parseObject(row.extras);
  const platform = parseObject(extras[EXTRAS_KEY]);
  delete platform[def.key];
  if (Object.keys(platform).length === 0) delete extras[EXTRAS_KEY];
  else extras[EXTRAS_KEY] = platform;

  await db.brandSetting.update({ where: { id: row.id }, data: { extras: JSON.stringify(extras) } });
  return mergePlatformSettings(extras[EXTRAS_KEY]);
}
