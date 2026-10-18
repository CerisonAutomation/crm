import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { SETTINGS_SECTIONS } from "@/lib/settings/registry";
import { loadPlatformSettings } from "@/lib/settings/store";

/**
 * Platform Settings — the registry-driven settings surface.
 *
 * GET /api/settings   authenticated, deny-by-default per section: the response
 *                     contains ONLY the sections the caller's role may read
 *                     (merged over canon). CLIENT gets `labels` only; RM/
 *                     SENIOR_RM/AUDITOR get `labels` + `operations`; ADMIN gets
 *                     everything. Unknown/forbidden sections are simply omitted.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const merged = await loadPlatformSettings();
    const settings: Record<string, unknown> = {};
    for (const section of SETTINGS_SECTIONS) {
      if (!section.readRoles.includes(ctx.role)) continue;
      settings[section.key] = merged[section.key];
    }
    return jsonOk({ settings });
  })(req);
}
