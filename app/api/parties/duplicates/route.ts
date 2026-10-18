import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { listDuplicateReviewQueueRoot } from "@/lib/duplicate-merge/composition";

export const dynamic = "force-dynamic";

// GET /api/parties/duplicates — party duplicate review queue, highest score
// first. Reads stay on the desk read cap; review + merge writes require
// "party.merge" (SENIOR_ONLY). Party names ride along so the review UI never
// shows bare ids.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const queue = await listDuplicateReviewQueueRoot(ctx.orgId);
    const ids = [...new Set(queue.flatMap((c) => [c.partyId, c.candidatePartyId]))];
    const parties = ids.length > 0
      ? await db.party.findMany({
          where: { orgId: ctx.orgId, id: { in: ids } },
          select: { id: true, name: true, email: true, company: true, status: true },
        })
      : [];
    const byId = new Map(parties.map((p) => [p.id, p]));
    return jsonOk({
      candidates: queue.map((c) => ({
        ...c,
        survivor: byId.get(c.partyId) ?? null,
        candidate: byId.get(c.candidatePartyId) ?? null,
      })),
    });
  })(req);
}
