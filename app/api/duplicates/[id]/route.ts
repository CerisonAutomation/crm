import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import {
  confirmDuplicateCandidate,
  dismissDuplicateCandidate,
  getDuplicateCandidate,
} from "@/lib/services/duplicate-candidate";
import { notFound, validationFailed } from "@/lib/api-errors";

// POST /api/duplicates/[id] — body: { action: "confirm" | "dismiss" }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const existing = await getDuplicateCandidate(id);
    if (!existing || existing.orgId !== ctx.orgId) throw notFound("Duplicate candidate not found");
    const body = await readJson<{ action?: "confirm" | "dismiss" }>(r);
    if (body?.action !== "confirm" && body?.action !== "dismiss") {
      throw validationFailed('action must be "confirm" or "dismiss"');
    }
    const duplicate = body.action === "confirm"
      ? await confirmDuplicateCandidate(id, ctx.userId)
      : await dismissDuplicateCandidate(id, ctx.userId);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: body.action === "confirm" ? "duplicate.confirmed" : "duplicate.dismissed",
      target: duplicate.id,
      before: { status: existing.status },
      after: { status: duplicate.status },
      correlationId,
    });
    return jsonOk({ duplicate });
  })(req);
}
