/**
 * Greece Golden Visa tier audit — Law 5100/2024.
 *
 * Validates a case's chosen location + property against the statutory investment
 * tiers before the file is dispatched, so a non-qualifying property is caught at
 * the desk rather than by the authority months later.
 *
 * The tiers (indicative planning figures — the authority's current circular
 * governs, and thresholds move by amendment):
 *   • Tier 1 — Attica, Thessaloniki, Mykonos, Santorini, and any island with a
 *     population over 3,100: €800,000 minimum, single property of ≥120 m².
 *   • Tier 2 — everywhere else: €400,000 minimum, single property of ≥120 m².
 *   • Tier 3 — conversion / restoration of a listed building: €250,000 minimum.
 *
 * A short-term let of a Golden Visa property is prohibited outright.
 *
 * Prisma-free and side-effect-free, so it is unit-testable without a database.
 */

/** Minimum investment per tier, in euro cents. */
export const GREECE_TIER_MIN_CENTS = {
  1: 80_000_000, // €800,000
  2: 40_000_000, // €400,000
  3: 25_000_000, // €250,000
} as const;

export type GreeceTier = keyof typeof GREECE_TIER_MIN_CENTS;

/** Minimum qualifying floor area for a single property, in m². */
export const GREECE_MIN_AREA_SQM = 120;

/** Island population above which the island falls into Tier 1. */
export const GREECE_TIER1_ISLAND_POP = 3_100;

/** Regions named in the statute as Tier 1 regardless of population. */
export const GREECE_TIER1_REGIONS: readonly string[] = [
  "Attica",
  "Thessaloniki",
  "Mykonos",
  "Santorini",
];

export interface GreeceSelectionInput {
  /** Region or island name, as recorded on the case. */
  region: string;
  /** Island population, when the property is on an island. */
  islandPop?: number;
  /** Floor area of the single property, in m². */
  areaSqm: number;
  /** Is this a conversion of a non-residential building? */
  isConversion?: boolean;
  /** Is this a listed-building restoration (the Tier 3 qualifying route)? */
  isListedRestoration?: boolean;
  /** Will the property be let short-term? */
  shortTermLet?: boolean;
}

export interface GreeceAuditResult {
  tier: GreeceTier;
  /** Minimum qualifying investment for the tier, in euro cents. */
  minCents: number;
  /** Every statutory condition the selection fails. Empty ⇒ compliant. */
  violations: string[];
}

/**
 * Audit a Greece selection against the Law 5100/2024 tiers.
 *
 * Returns the tier the selection falls into, its minimum investment, and every
 * condition it violates. A non-empty `violations` array means the file must not
 * be dispatched until the selection is corrected.
 */
export function auditGreeceSelection(input: GreeceSelectionInput): GreeceAuditResult {
  const violations: string[] = [];

  // A short-term let of a Golden Visa property is prohibited outright —
  // evaluated for every selection, before any tier branching.
  if (input.shortTermLet) {
    violations.push("short-term rentals banned on GV properties");
  }

  // Tier 3 — conversion of a non-residential building. Only a LISTED restoration
  // qualifies at the reduced threshold; a plain conversion does not.
  if (input.isConversion) {
    if (!input.isListedRestoration) {
      violations.push("tier3 requires a listed-building restoration; a plain conversion does not qualify");
    }
    return { tier: 3, minCents: GREECE_TIER_MIN_CENTS[3], violations };
  }

  const tier1Zone =
    GREECE_TIER1_REGIONS.includes(input.region) ||
    (input.islandPop ?? 0) > GREECE_TIER1_ISLAND_POP;

  if (tier1Zone) {
    if (input.areaSqm < GREECE_MIN_AREA_SQM) {
      violations.push(`tier1 requires >=${GREECE_MIN_AREA_SQM}sqm single property`);
    }
    return { tier: 1, minCents: GREECE_TIER_MIN_CENTS[1], violations };
  }

  if (input.areaSqm < GREECE_MIN_AREA_SQM) {
    violations.push(`tier2 requires >=${GREECE_MIN_AREA_SQM}sqm`);
  }
  return { tier: 2, minCents: GREECE_TIER_MIN_CENTS[2], violations };
}
