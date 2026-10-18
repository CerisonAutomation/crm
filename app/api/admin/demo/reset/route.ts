import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { resetDemoData } from "@/lib/services/demo-reset";

/**
 * POST /api/admin/demo/reset — rebuild the sandbox demo dataset from the
 * canonical seed definitions.
 *
 * Admin-only (`admin.manage`). The seed scripts are the source of truth; this
 * just re-runs them in order, so the UI action can never drift from
 * `pnpm db:seed`. Production requests are rejected.
 */
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");

    const result = await resetDemoData({
      id: ctx.userId,
      label: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      orgId: ctx.orgId,
    });

    return jsonOk(result);
  })(req);
}
