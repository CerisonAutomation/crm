import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { createSLAClock, getSLAClocks, checkSLABreaches } from "@/lib/services/sla";
import { validationFailed } from "@/lib/api-errors";

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const clocks = await getSLAClocks(ctx.orgId);
    return jsonOk({ clocks });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{ name?: string; targetHours?: number; caseId?: string }>(r);
    const name = body?.name as string;
    const targetHours = body?.targetHours as number;
    const caseId = body?.caseId as string | undefined;
    if (!name || !targetHours) throw validationFailed("Name and targetHours are required");
    const clock = await createSLAClock({ orgId: ctx.orgId, caseId, name, targetHours });
    return jsonOk({ clock }, 201);
  })(req);
}
