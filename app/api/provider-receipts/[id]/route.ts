import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getProviderReceipt, updateProviderReceipt } from "@/lib/services/provider-receipt";
import { notFound } from "@/lib/api-errors";

async function ownedReceipt(id: string, orgId: string) {
  const receipt = await getProviderReceipt(id);
  if (!receipt || receipt.orgId !== orgId) throw notFound("Provider receipt not found");
  return receipt;
}

// GET /api/provider-receipts/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const receipt = await ownedReceipt(id, ctx.orgId);
    return jsonOk({ receipt });
  })(req);
}

// PATCH /api/provider-receipts/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedReceipt(id, ctx.orgId);
    const body = await readJson<{
      status?: "PENDING" | "SUCCEEDED" | "FAILED" | "TIMEOUT";
      responseHash?: string;
      responseStatus?: number;
      error?: string;
      retryCount?: number;
    }>(r);
    const receipt = await updateProviderReceipt(id, {
      status: body?.status,
      responseHash: body?.responseHash,
      responseStatus: body?.responseStatus,
      error: body?.error,
      retryCount: body?.retryCount,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "provider_receipt.updated",
      target: receipt.id,
      after: body,
      correlationId,
    });
    return jsonOk({ receipt });
  })(req);
}
