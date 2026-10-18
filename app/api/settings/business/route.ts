import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  loadBusinessSettings,
  saveBusinessSettings,
  validateBusinessPatch,
} from "@/lib/business/settings";

/**
 * Business Settings — firm / fee / letter copy edited behind one admin surface.
 *
 * GET  /api/settings/business   authenticated staff only (CLIENT → 403). The
 *                               merged settings (DB row deep-merged over the
 *                               canon defaults) are needed only inside the
 *                               staff/admin app — never on a public surface.
 * PUT  /api/settings/business   business.write capability (ADMIN only,
 *                               deny-by-default — others get 403). Validates
 *                               per section, deep-merges over the current
 *                               settings, persists the singleton row, audits.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);
    const settings = await loadBusinessSettings();
    return jsonOk({ settings });
  })(req);
}

export async function PUT(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "business.write");

    const body = await readJson<Record<string, unknown>>(r);
    const patch = validateBusinessPatch(body);
    const before = await loadBusinessSettings();
    const settings = await saveBusinessSettings(ctx.orgId, patch);

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: "business.updated",
      target: `BrandSetting/${ctx.orgId}`,
      before: { firm: before.firm, fees: before.fees, letters: before.letters },
      after: { firm: settings.firm, fees: settings.fees, letters: settings.letters },
      correlationId,
    });
    return jsonOk({ settings });
  })(req);
}
