import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createProviderReceipt, getProviderReceipts } from "@/lib/services/provider-receipt";
import { validationFailed } from "@/lib/api-errors";

// GET /api/provider-receipts?provider=&status=
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const receipts = await getProviderReceipts(ctx.orgId, {
      provider: q.get("provider") || undefined,
      status: q.get("status") || undefined,
    });
    return jsonOk({ receipts });
  })(req);
}

// POST /api/provider-receipts — ledger an outbound provider operation.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      provider?: string;
      operation?: string;
      operationKey?: string;
      requestHash?: string;
      responseHash?: string;
      responseStatus?: number;
      error?: string;
    }>(r);
    if (!body?.provider) throw validationFailed("provider is required");
    if (!body?.operation) throw validationFailed("operation is required");
    if (!body?.operationKey) throw validationFailed("operationKey is required");
    const receipt = await createProviderReceipt({
      orgId: ctx.orgId,
      provider: body.provider,
      operation: body.operation,
      operationKey: body.operationKey,
      requestHash: body.requestHash,
      responseHash: body.responseHash,
      responseStatus: body.responseStatus,
      error: body.error,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "provider_receipt.created",
      target: receipt.id,
      after: { provider: receipt.provider, operation: receipt.operation },
      correlationId,
    });
    return jsonOk({ receipt }, 201);
  })(req);
}
