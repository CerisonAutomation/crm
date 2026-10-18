import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { startReconciliation, getReconciliationRuns } from "@/lib/services/reconciliation";
import { validationFailed } from "@/lib/api-errors";

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const runs = await getReconciliationRuns(ctx.orgId);
    return jsonOk({ runs });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{ type?: string }>(r);
    const type = body?.type as string;
    if (!type || !["PROVIDER", "PAYMENT", "CASE", "DOCUMENT"].includes(type)) {
      throw validationFailed("Type must be one of: PROVIDER, PAYMENT, CASE, DOCUMENT");
    }
    const run = await startReconciliation(ctx.orgId, type as "PROVIDER" | "PAYMENT" | "CASE" | "DOCUMENT");
    return jsonOk({ run }, 201);
  })(req);
}
