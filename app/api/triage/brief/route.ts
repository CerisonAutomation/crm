import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { recalculateTriage, type TriageScore } from "@/lib/services/triage";
import { aiChat } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

// GET /api/triage/brief — prioritised queue for the caller's organisation.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
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
    });
  })(req);
}

// POST /api/triage/brief { caseIds?: string[] } — staff-only AI action briefs
// for the top-risk cases. Fail-closed: failures return per-case null briefs,
// never invented advice. Max 5 cases per call (cost-bounded).
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const scores = await recalculateTriage(ctx.orgId);
    const hot = scores.filter((s) => s.tier === "P1" || s.tier === "P2").slice(0, 5);
    const briefs: Array<{ caseId: string; reference: string; tier: string; brief: string | null }> = await Promise.all(
      hot.map(async (s) => {
        // Scoped lookup (defence in depth): only ever read a case in the caller's org.
        const kase = await db.case.findFirst({ where: { id: s.caseId, orgId: ctx.orgId }, select: { reference: true, status: true, riskFlag: true } });
        const prompt =
          `You triage Swiss/EU residency cases. Case ${kase?.reference ?? s.caseId} is ${s.tier} ` +
          `(score ${s.score}). Signals: ${s.factors.join("; ") || "none"}. ` +
          `Status ${kase?.status}, risk ${kase?.riskFlag}. Reply in 2 short lines: (1) most urgent next action, (2) what to check first. No greeting.`;
        const res = await aiChat(
          [
            { role: "system", content: "You are a terse operations assistant for immigration caseworkers." },
            { role: "user", content: prompt },
          ],
          { timeoutMs: 20_000, disableThinking: true },
        );
        return { caseId: s.caseId, reference: kase?.reference ?? s.caseId, tier: s.tier, brief: res?.text ?? null };
      }),
    );
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.name, action: "triage.brief", target: `${briefs.length} cases`, after: { model: briefs.some((b) => b.brief) ? "llm:glm" : "unavailable" } });
    return jsonOk({ briefs, model: briefs.some((b) => b.brief) ? "llm:glm" : "unavailable" });
  })(req);
}
