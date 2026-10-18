import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

// GET /api/me/case — the client's full case view (tenant-scoped: own case only)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.own");
    const c = await db.case.findFirst({
      where: { clientId: ctx.userId },
      include: {
        programme: true,
        letters: true,
        documents: { include: { fields: true, reviews: { include: { reviewer: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } },
        requests: { include: { documents: { select: { id: true, status: true } } }, orderBy: { createdAt: "asc" } },
        assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 30 },
        dispatches: { include: { followUps: true }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!c) return jsonOk({ case: null });
    const letter = c.letters[0]
      ? { id: c.letters[0].id, fileName: c.letters[0].fileName, sizeBytes: c.letters[0].sizeBytes, createdAt: c.letters[0].createdAt }
      : null;
    return jsonOk({
      case: {
        id: c.id, reference: c.reference, status: c.status,
        dataApproval: c.dataApproval, serviceApproval: c.serviceApproval,
        programme: c.programme, createdAt: c.createdAt,
        rm: c.assignments[0]?.user ?? null,
        documents: c.documents,
        requests: c.requests,
        timeline: c.statusHistory,
        dispatches: c.dispatches,
        letter,
      },
    });
  })(req);
}

