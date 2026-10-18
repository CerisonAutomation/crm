import { NextRequest } from "next/server";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { loadBusinessSettings, resetBusinessSettings } from "@/lib/business/settings";

/**
 * POST /api/settings/business/reset — revert the business settings to canon.
 *
 * Removes the stored configuration from the org's brand-settings row; every
 * consumer immediately falls back to the canon defaults in
 * src/lib/business/defaults.ts (zero-config state).
 * business.write capability (ADMIN only). Audited with the pre-reset snapshot.
 */
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "business.write");

    const before = await loadBusinessSettings();
    await resetBusinessSettings(ctx.orgId);

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: "business.reset",
      target: `BrandSetting/${ctx.orgId}`,
      before: { firm: before.firm, fees: before.fees, letters: before.letters },
      after: { note: "row deleted — canon defaults reasserted" },
      correlationId,
    });

    const settings = await loadBusinessSettings();
    return jsonOk({ settings, reset: true });
  })(req);
}
