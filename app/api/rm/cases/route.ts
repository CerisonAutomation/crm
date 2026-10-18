import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { parseListParams, decodeCursor, nextPage } from "@/lib/pagination";
import { requireAuth, requireCapability } from "@/lib/auth";
import { slaForCase } from "@/lib/domain/lifecycle";
import { loadPlatformSettings } from "@/lib/settings/store";

// GET /api/rm/cases — assigned-case queue (RM/SENIOR_RM; auditor read-only)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    const mine = url.searchParams.get("mine") === "1";
    // Keyset pagination over `updatedAt desc, id desc` with an opaque cursor:
    // the queue stays bounded at 100 rows/page instead of silently truncating.
    const { limit, cursor } = parseListParams(url, { defaultLimit: 100, maxLimit: 100 });

    const rows = await db.case.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(mine && (ctx.role === "RM" || ctx.role === "SENIOR_RM")
          ? { assignments: { some: { userId: ctx.userId } } }
          : {}),
        ...(q
          ? {
              OR: [
                { reference: { contains: q } },
                { client: { name: { contains: q } } },
                { client: { email: { contains: q } } },
              ],
            }
          : {}),
        orgId: ctx.orgId,
      },
      include: {
        client: { select: { id: true, name: true, email: true, nationality: true } },
        programme: { select: { name: true, country: true } },
        assignments: { include: { user: { select: { name: true } } } },
        documents: { select: { id: true, status: true, type: true } },
        requests: { select: { id: true, status: true } },
        dispatches: { select: { trackingId: true, status: true } },
        letters: { select: { id: true } },
        statusHistory: { select: { to: true, command: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: decodeCursor(cursor) }, skip: 1 } : {}),
      take: limit + 1,
    });

    // Trim the sentinel row before the (relatively expensive) SLA mapping.
    const page = nextPage(rows, limit, (c) => c.id);
    const cases = page.items;

    const now = new Date();
    // Operator-set stage service levels, so the queue's SLA column and overdue
    // flags follow the settings rather than the built-in canon alone.
    const slaOverrides = (await loadPlatformSettings()).operations.slaDays;
    const queue = cases.map((c) => {
      // Per-case SLA against the current stage — lets the RM desk sort/flag by
      // time-to-breach without recomputing the lifecycle model client-side.
      const sla = slaForCase(
        { status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt, statusHistory: c.statusHistory },
        now,
        slaOverrides
      );
      return {
        id: c.id,
        reference: c.reference,
        status: c.status,
        dataApproval: c.dataApproval,
        serviceApproval: c.serviceApproval,
        riskFlag: c.riskFlag,
        client: c.client,
        programme: c.programme,
        rm: c.assignments[0]?.user?.name ?? null,
        documentsTotal: c.documents.length,
        documentsApproved: c.documents.filter((d) => d.status === "RM_APPROVED").length,
        openRequests: c.requests.filter((rq) => rq.status === "OPEN").length,
        dispatch: c.dispatches[0] ?? null,
        hasLetter: c.letters.length > 0,
        sla: sla
          ? { stageKey: sla.stageKey, slaDays: sla.slaDays, ageDays: Math.round(sla.ageDays), remainingDays: Math.round(sla.remainingDays), overdue: sla.overdue }
          : null,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
        ageDays: Math.floor((now.getTime() - c.createdAt.getTime()) / 86400000),
      };
    });
    return jsonOk({ cases: queue, nextCursor: page.nextCursor });
  })(req);
}

