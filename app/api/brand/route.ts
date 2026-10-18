import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit, redact } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import type { CanonBrand } from "@/lib/brand/defaults";
import {
  loadBrandSettings,
  saveBrandSettings,
  validateBrandPatch,
} from "@/lib/brand/settings";

/**
 * Brand Settings — the single source the whole app re-skins from.
 *
 * GET  /api/brand   PUBLIC (no auth): the landing page and login render
 *                   pre-auth, so the merged settings (DB row deep-merged
 *                   over canon defaults) are readable by anyone. Nothing
 *                   secret here — it is the public brand identity. The
 *                   server-side `extras` bag (which carries the business
 *                   configuration — see src/lib/business/settings.ts) is
 *                   stripped from this unauthenticated response.
 * PUT  /api/brand   brand.write capability (ADMIN only, deny-by-default —
 *                   RM/CLIENT/AUDITOR get 403). Validates per section
 *                   (hex regex, string caps), deep-merges over the current
 *                   settings, persists the singleton row, audits the change.
 */
export async function GET(req: NextRequest) {
  return handler(async () => {
    const settings: CanonBrand & { updatedAt?: string; extras?: Record<string, unknown> } =
      await loadBrandSettings();
    // `extras: undefined` is dropped by JSON serialization — server-side only.
    return jsonOk({ settings: { ...settings, extras: undefined } });
  })(req);
}

export async function PUT(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "brand.write");

    const body = await readJson<Record<string, unknown>>(r);
    const patch = validateBrandPatch(body);
    const before = await loadBrandSettings();
    const settings = await saveBrandSettings(ctx.orgId, patch);

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: "brand.updated",
      target: `BrandSetting/${ctx.orgId}`,
      before: redact({ tokens: before.tokens, wordmark: before.wordmark, slogan: before.slogan, contact: before.contact, hero: before.hero, logo: before.logo }),
      after: redact({ tokens: settings.tokens, wordmark: settings.wordmark, slogan: settings.slogan, contact: settings.contact, hero: settings.hero, logo: settings.logo }),
      correlationId,
    });
    return jsonOk({ settings });
  })(req);
}
