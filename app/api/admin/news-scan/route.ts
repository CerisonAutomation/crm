import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { runNewsScan, corroborateFinding, approveFinding, dismissFinding } from "@/lib/services/news-scan";

/**
 * GET /api/admin/news-scan — list profiles and findings.
 * POST /api/admin/news-scan — run a scan, corroborate, approve, or dismiss.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");

    const profiles = await db.newsScanProfile.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
    });
    const findings = await db.newsScanFinding.findMany({
      where: { profile: { orgId: ctx.orgId } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return jsonOk({ profiles, findings });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");

    const body = await readJson<{
      action?: string;
      profileId?: string;
      findingId?: string;
      sourceUrl?: string;
      reason?: string;
    }>(r);

    const action = body.action ?? "run";

    if (action === "run") {
      if (!body.profileId) throw new DomainError("profileId required", 400);
      const result = await runNewsScan(body.profileId);
      return jsonOk({ result });
    }

    if (action === "corroborate") {
      if (!body.findingId || !body.sourceUrl) throw new DomainError("findingId and sourceUrl required", 400);
      const result = await corroborateFinding(body.findingId, body.sourceUrl, ctx.userId, `${ctx.name} [${ctx.role}]`);
      return jsonOk({ result });
    }

    if (action === "approve") {
      if (!body.findingId) throw new DomainError("findingId required", 400);
      const result = await approveFinding(body.findingId, ctx.userId, `${ctx.name} [${ctx.role}]`, body.reason ?? "");
      return jsonOk({ result });
    }

    if (action === "dismiss") {
      if (!body.findingId) throw new DomainError("findingId required", 400);
      const result = await dismissFinding(body.findingId, ctx.userId, `${ctx.name} [${ctx.role}]`, body.reason ?? "");
      return jsonOk({ result });
    }

    throw new DomainError(`Unknown action: ${action}`, 400);
  })(req);
}