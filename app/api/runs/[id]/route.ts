import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

// GET /api/runs/[id] — node-level execution detail (redacted previews)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "run.read");
    const run = await db.workflowRun.findUnique({
      where: { id },
      include: {
        workflow: { select: { name: true, currentVersion: true, orgId: true } },
        case: { select: { reference: true, id: true } },
        nodeRuns: { orderBy: { startedAt: "asc" } },
      },
    });
    if (!run) throw new DomainError("Run not found", 404);
    if (run.workflow.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    return jsonOk({ run });
  })(req);
}
