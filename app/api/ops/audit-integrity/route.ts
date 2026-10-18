import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { verifyChain } from "@/lib/services/case-ledger";

export const dynamic = "force-dynamic";

// GET /api/ops/audit-integrity — staff audit-ledger health: volume by day,
// orphan rows (missing actor), correlation-id coverage, AND hash-chain
// verification of the append-only CaseEvent ledger (spec §2 / R2).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [total, orphaned, uncorrelated, chain] = await Promise.all([
      db.auditEvent.count({ where: { orgId: ctx.orgId, createdAt: { gte: since } } }),
      db.auditEvent.count({ where: { orgId: ctx.orgId, createdAt: { gte: since }, actorId: null, actorLabel: "system" } }),
      db.auditEvent.count({ where: { orgId: ctx.orgId, createdAt: { gte: since }, correlationId: null } }),
      verifyChain(),
    ]);
    return jsonOk({
      windowDays: 30,
      total,
      systemRows: orphaned,
      uncorrelated,
      chain: {
        ok: chain.ok,
        checked: chain.checked,
        mismatches: chain.mismatches.length,
        ...(chain.mismatches.length > 0 ? { details: chain.mismatches.slice(0, 5) } : {}),
      },
      ok: chain.ok,
      generatedAt: new Date().toISOString(),
    });
  })(req);
}
