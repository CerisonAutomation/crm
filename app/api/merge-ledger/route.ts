import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";
import { getMergeLedger } from "@/lib/services/merge-ledger";

// GET /api/merge-ledger?partyId= — merge/split audit trail for the caller's org.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const partyId = new URL(r.url).searchParams.get("partyId") || undefined;
    const entries = await getMergeLedger(ctx.orgId, partyId);
    return jsonOk({ entries });
  })(req);
}
