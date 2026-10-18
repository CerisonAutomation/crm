/**
 * Seed→catalogue key reconciliation.
 *
 * There are two programme vocabularies in this codebase and they were authored
 * independently:
 *
 *   1. `prisma/seed.ts` PROGRAMMES — the operational rows cases are filed
 *      against. Keys like DE_BUSINESS, KN_CITIZENSHIP, MT_CITIZENSHIP.
 *   2. `src/lib/domain/programmes.ts` PROGRAMMES — the research/capability
 *      catalogue. Same real-world routes, but keys like DE_RESIDENCE_BUSINESS,
 *      KN_CBI, MT_CITIZENSHIP_MEIN, and 14 Swiss routes the seed never had.
 *
 * Only 4 keys (AE_GOLDEN, AT_RESIDENCE, ES_GOLDEN, PT_GOLDEN) are spelled the
 * same in both. Of the other 17, this map reconciles 13 explicitly and 4 are
 * declared in UNRESEARCHED_SEED_KEYS below. Without this map,
 * `programmeByKey(seedKey)` returns undefined for those, so `Programme.meta` is
 * written as JsonNull and the pre-scan / triage / public-catalogue join
 * silently degrade to "no data".
 *
 * This module is the ONE place that translation is allowed to live. It is
 * deliberately a static map rather than a fuzzy label match: a wrong pairing
 * would attach one programme's fee, legal basis and eligibility rules to
 * another, which is worse than no metadata at all. Every entry is therefore an
 * explicit human decision, and `tests/programme-alias.test.ts` asserts each one
 * resolves to a real catalogue key AND that the two labels agree on country.
 *
 * Coverage is asserted too: if a new seed key is added without an alias, the
 * test fails rather than quietly writing nulls.
 */
import { programmeByKey, type Programme } from "./programmes";

/**
 * seed key → catalogue key. Every entry is deliberate.
 *
 * Left-hand keys are the legacy/operational spelling the seed uses; right-hand
 * keys are the canonical catalogue spelling that owns the capability metadata.
 */
export const SEED_KEY_ALIASES: Readonly<Record<string, string>> = {
  // ── Caribbean citizenship ─────────────────────────────────────────────
  AG_CITIZENSHIP: "AG_CBI",
  KN_CITIZENSHIP: "KN_CBI",
  ME_CITIZENSHIP: "TR_CBI", // Montenegro's CBI closed 2022; T\u00fcrkiye is the live equivalent on the desk
  TR_CITIZENSHIP: "TR_CBI",
  VU_CITIZENSHIP: "VU_CBI",

  // ── European citizenship / residence ──────────────────────────────────
  AT_CITIZENSHIP_MERIT: "AT_RESIDENCE", // merit naturalisation has no standalone catalogue entry; AT residence is the filing route
  CY_CITIZENSHIP: "CY_PERMANENT", // naturalisation-after-residence sits on the permanent-residence route
  CY_RESIDENCE: "CY_PERMANENT",
  DE_BUSINESS: "DE_RESIDENCE_BUSINESS",
  GR_RESIDENCE: "GR_GOLDEN",
  IT_RESIDENCE: "IT_INVESTOR",
  MT_CITIZENSHIP: "MT_CITIZENSHIP_MEIN",
  MT_RESIDENCE: "MT_CITIZENSHIP_MEIN", // Malta permanent residence is the precursor leg to the MEIN citizenship file
  ES_GOLDEN: "ES_GOLDEN",
  PT_GOLDEN: "PT_GOLDEN",
  AE_GOLDEN: "AE_GOLDEN",
  AT_RESIDENCE: "AT_RESIDENCE",

  // ── Researched 2026-10-06 (previously declared unresearched) ──────────
  AM_RESIDENCE: "AM_RESIDENCE",
  SK_RESIDENCE: "SK_RESIDENCE",
  SI_RESIDENCE: "SI_RESIDENCE",
  US_EB5: "US_EB5",
};

/**
 * Seeded programmes the research catalogue does NOT cover.
 *
 * Empty as of 2026-10-06: every seeded programme now has authored capability
 * metadata. Kept as an explicit list because the state recurs whenever a new
 * operational route is seeded before its research is written — and because a
 * silent JsonNull is exactly the failure the alias tests exist to catch.
 */
export const UNRESEARCHED_SEED_KEYS: readonly string[] = [];

/**
 * Catalogue keys that exist only in the research catalogue and are never seeded
 * as operational rows. Listed so the coverage assertion can distinguish "not
 * seeded by design" from "seeded but unmapped".
 */
export const CATALOGUE_ONLY_KEYS: readonly string[] = [
  "ADVISORY_ONLY",
  "SVC_PASSPORT_RENEWAL_KN",
  "SVC_COMPANY_MALTA",
  "SVC_COMPANY_UAE_MEYDAN",
  "SVC_BANK_ACCOUNT",
  "SVC_JOB_SEARCH",
  "INV_REAL_ESTATE",
  "INV_FUNDS_BUSINESS",
  "INV_PORTUGAL_GOLDEN",
  "INV_ITALY_VENICE_HOTEL",
  "INV_ERLEBNISBAHN",
  // European routes researched but not yet operational rows
  "AT_CITIZENSHIP_DESCENDANTS",
  "DE_BLUE_CARD",
  "DM_CBI",
  "GD_CBI",
  "LC_CBI",
  "EG_CBI",
  "JO_CBI",
  "MY_MM2H",
  "TH_LTR",
  // Swiss routes — researched in citizen-lane/research, not yet operational rows
  "CH_LUMP_SUM",
  "CH_PERMIT_B_EU",
  "CH_PERMIT_B_NON_EU",
  "CH_PERMIT_C",
  "CH_PERMIT_L",
  "CH_PERMIT_G",
  "CH_FAMILY_REUNIFICATION",
  "CH_NATURALISATION",
  "CH_NATURALISATION_SPOUSE",
  "CH_LEX_KOLLER",
  "CH_COMPANY_RELOCATION",
  "CH_STUDENT_PERMIT",
  "CH_RETIREMENT",
  "CH_D_VISA",
];

/**
 * Resolve a seed programme key to its catalogue capability entry.
 *
 * Returns the catalogue Programme, or undefined when the key is unknown to the
 * catalogue. Callers MUST treat undefined as "no metadata available" and
 * degrade — never substitute a default, because a default fee or eligibility
 * rule is a factual claim about a jurisdiction we did not research.
 */
export function catalogueForSeedKey(seedKey: string): Programme | undefined {
  return programmeByKey(SEED_KEY_ALIASES[seedKey] ?? seedKey);
}

/** Resolve a seed key to the catalogue KEY it maps onto, or undefined. */
export function catalogueKeyForSeedKey(seedKey: string): string | undefined {
  return catalogueForSeedKey(seedKey)?.key;
}

/**
 * Operational kind of a seeded row — `CITIZENSHIP` or `RESIDENCE`.
 *
 * Derived from the SEED key, never from the alias target: several aliases
 * deliberately point a citizenship row at a residence capability (Cyprus
 * naturalisation → `CY_PERMANENT`, Malta MPRP → `MT_CITIZENSHIP_MEIN`) because
 * that is where the researched fee/legal data lives. Reusing the alias target's
 * `kind` would label those rows — and the landing page's citizenship/residence
 * filter counts — as the wrong thing. Every seeded key spells its own kind out
 * (`*_CITIZENSHIP*` vs `*_RESIDENCE` / `*_GOLDEN` / `DE_BUSINESS` / `US_EB5`),
 * so the operational kind is read straight off it.
 */
export function kindForSeedKey(seedKey: string): "RESIDENCE" | "CITIZENSHIP" {
  return seedKey.includes("CITIZENSHIP") ? "CITIZENSHIP" : "RESIDENCE";
}
