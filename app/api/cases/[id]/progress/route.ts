import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { recomputeCaseProgress } from "@/lib/services/case-progress";
import { DomainError } from "@/lib/domain/states";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "case.read.own");
    } else {
      requireCapability(ctx, "case.read.all");
    }
    // The recompute function does its own case lookup + org check internally
    const progress = await recomputeCaseProgress(id);
    return jsonOk({ progress });
  })(req);
}