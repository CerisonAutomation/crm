import { db } from "@/lib/db";
import { FEATURE_DEFAULTS, type FeatureFlagKey } from "@/lib/settings/feature-flags";

/**
 * The read path for feature flags — the part that was missing.
 *
 * The admin console has always let an operator create a flag and flip it, and
 * its notes claim `maintenance_mode` blocks uploads and `ai_ocr` gates
 * extraction. Nothing read the table, so both claims were false: the switch
 * moved and the platform did not. Server code calls the two functions below.
 *
 * Metadata (keys, defaults, notes) lives in `./feature-flags` so the client
 * console can render the same description without importing Prisma.
 */

/**
 * Is `key` on for the platform? Unknown keys resolve to `false` so a typo can
 * never switch a gate on by accident. A stored row always wins over the
 * default, including when it says `false`.
 */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const row = await db.featureFlag.findUnique({ where: { key }, select: { enabled: true } });
  return row ? row.enabled : FEATURE_DEFAULTS[key];
}
