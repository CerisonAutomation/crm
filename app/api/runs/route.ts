import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

// GET /api/runs — run history (filters: workflowId, caseId, status)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "run.read");
    const url = new URL(r.url);
    const runs = await db.workflowRun.findMany({
      where: {
        workflow: { orgId: ctx.orgId },
        ...(url.searchParams.get("workflowId") ? { workflowId: url.searchParams.get("workflowId")! } : undefined),
        ...(url.searchParams.get("caseId") ? { caseId: url.searchParams.get("caseId")! } : undefined),
        ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : undefined),
      },
      include: { workflow: { select: { name: true } }, case: { select: { reference: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return jsonOk({ runs });
  })(req);
}
