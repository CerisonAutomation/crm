import { NextRequest } from "next/server";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { runAutoResearch } from "@/lib/ai/research";

/**
 * GET /api/ai/research — auto-research over live, org-scoped operational data.
 * Returns ranked insights (gaps) + a narrated summary. Staff/admin only.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const result = await runAutoResearch(ctx.orgId);
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "ai.research.run", target: "platform-signals", after: { insights: result.insights.length } });
    return jsonOk(result);
  })(req);
}
