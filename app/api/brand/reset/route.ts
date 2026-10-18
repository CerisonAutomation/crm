import { NextRequest } from "next/server";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadBrandSettings } from "@/lib/brand/settings";

/**
 * POST /api/brand/reset — revert the brand to canon.
 *
 * Deletes the org's BrandSetting row; every consumer immediately falls back
 * to the canon defaults in src/lib/brand/defaults.ts (zero-config state).
 * brand.write capability (ADMIN only). Audited with the pre-reset snapshot.
 */
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "brand.write");

    const before = await loadBrandSettings();
    await db.brandSetting.deleteMany({ where: { orgId: ctx.orgId } });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: "brand.reset",
      target: `BrandSetting/${ctx.orgId}`,
      before: {
        tokens: before.tokens,
        wordmark: before.wordmark,
        slogan: before.slogan,
      },
      after: { note: "row deleted — canon defaults reasserted" },
      correlationId,
    });

    const settings = await loadBrandSettings();
    return jsonOk({ settings, reset: true });
  })(req);
}
