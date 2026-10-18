import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { listDeliveries, processDueRetries } from "@/lib/integrations/webhooks";

// GET /api/integrations/webhooks/deliveries?endpointId= — delivery log,
// latest first (limit 50). Runs the due-retry catch-up sweep first so a
// mere page view also drives retry progress after restarts/idle periods.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    await processDueRetries();
    const endpointId = r.nextUrl.searchParams.get("endpointId") ?? undefined;
    const deliveries = await listDeliveries(endpointId || undefined, 50, ctx.orgId);
    return jsonOk({ deliveries });
  })(req);
}
