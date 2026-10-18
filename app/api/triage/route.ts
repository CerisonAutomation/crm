import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { recalculateTriage, scoreCase } from "@/lib/services/triage";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";

// GET /api/triage — prioritised active-case queue (P1 first) with scoring factors.
// With ?caseId=... returns a single case's TriageScore (staff only).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const { searchParams } = new URL(r.url);
    const caseId = searchParams.get("caseId");

    if (caseId) {
      // Single case score — requires staff capability
      requireCapability(ctx, "case.read.all");
      const kase = await db.case.findUnique({ where: { id: caseId }, select: { orgId: true } });
      if (!kase || kase.orgId !== ctx.orgId) throw new DomainError("Case not found", 404);
      const score = await scoreCase(caseId);
      if (!score) throw new DomainError("Case not found", 404);
      return jsonOk(score);
    }

    // Full queue — org-scoped
    requireCapability(ctx, "case.read.all");
    const scores = await recalculateTriage(ctx.orgId);
    return jsonOk({
      queue: scores,
      counts: {
        P1: scores.filter((s) => s.tier === "P1").length,
        P2: scores.filter((s) => s.tier === "P2").length,
        P3: scores.filter((s) => s.tier === "P3").length,
      },
      generatedAt: new Date().toISOString(),
      actor: ctx.name,
    });
  })(req);
}

// POST /api/triage — rescore one case ({caseId}) or the whole queue ({}) — triage.run.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "triage.run");
    const body = await readJson<{ caseId?: string }>(r);
    if (body.caseId) {
      const kase = await db.case.findUnique({ where: { id: body.caseId }, select: { orgId: true } });
      if (!kase || kase.orgId !== ctx.orgId) throw new DomainError("Case not found", 404);
      const score = await scoreCase(body.caseId);
      if (!score) throw new DomainError("Case not found", 404);
      return jsonOk({ score });
    }
    const scores = await recalculateTriage(ctx.orgId);
    await db.auditEvent.create({
      data: { orgId: ctx.orgId, actorLabel: ctx.name, action: "triage.recalculated", target: "case-queue", after: JSON.stringify({ cases: scores.length }) },
    }).catch(() => undefined);
    return jsonOk({ queue: scores, recalculated: scores.length });
  })(req);
}
