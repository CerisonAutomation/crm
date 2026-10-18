/**
 * Feature-flag metadata — client-safe.
 *
 * The admin console renders these notes and the runtime reads them when it
 * gates behaviour, so they must live in a module both sides can import without
 * pulling Prisma into the browser bundle. The database read path is
 * `src/lib/settings/features.ts`; this file holds only data.
 *
 * The admin console has always let an operator flip a flag while claiming an
 * effect. Nothing read the table, so the claim was false. These constants are
 * now the single description of what each flag means, shared by the switch and
 * the gate.
 */

export const FEATURE_FLAGS = ["maintenance_mode", "ai_ocr", "push_notifications", "lane_pages_public"] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number];

/**
 * Behaviour when no row exists. `ai_ocr` defaults on because extraction is the
 * platform's existing behaviour; `maintenance_mode` defaults off because a
 * platform must never lock itself down by omission.
 */
export const FEATURE_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  maintenance_mode: false,
  ai_ocr: true,
  push_notifications: true,
  lane_pages_public: true,
};

/** The documented meaning of each flag, shown in the console and the API note. */
export const FEATURE_NOTES: Record<FeatureFlagKey, string> = {
  maintenance_mode: "When on, every document upload is rejected. The switch itself is the override — turn it off to let uploads through again.",
  ai_ocr: "When off, uploads are stored but no fields are read from them; the desk reads them manually.",
  push_notifications: "When off, no web-push notifications are sent even to subscribed devices.",
  lane_pages_public: "When off, published Lane Pages return 404 — the public journal is hidden.",
};
