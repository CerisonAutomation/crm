import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  CONTROLLER,
  PROCESSING_ACTIVITIES,
  PURGE_TIER,
  LEGAL_HOLD_MODELS,
  ENGAGEMENT_LIFETIME_MODELS,
} from "@/lib/compliance/data-map";

/**
 * Record of Processing Activities (RoPA) as JSON.
 *
 * GET /api/compliance/ropa   authenticated staff only (CLIENT → 403). Returns
 *                            the controller block, every processing activity,
 *                            the automated purge tier, the models under legal
 *                            hold and the engagement-lifetime models — the
 *                            governance register as machine-readable data.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);

    return jsonOk({
      generatedAt: new Date().toISOString(),
      controller: CONTROLLER,
      activities: PROCESSING_ACTIVITIES,
      purgeTier: PURGE_TIER,
      legalHold: LEGAL_HOLD_MODELS,
      engagementLifetime: ENGAGEMENT_LIFETIME_MODELS,
    });
  })(req);
}
