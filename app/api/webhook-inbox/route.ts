import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";
import { getWebhookInboxEntries } from "@/lib/services/webhook-inbox";

// GET /api/webhook-inbox — ADMIN-only inbound webhook ledger.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const params = new URL(r.url).searchParams;
    const entries = await getWebhookInboxEntries(ctx.orgId, {
      status: params.get("status") || undefined,
      provider: params.get("provider") || undefined,
    });
    return jsonOk({ entries });
  })(req);
}
