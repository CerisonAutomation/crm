import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, audit, actorLabel } from "@/lib/api-helpers";
import { deleteBusinessSetting, getBusinessSetting } from "@/lib/services/business-setting";
import { notFound } from "@/lib/api-errors";

// GET /api/business-settings/[key] — ADMIN-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { key } = await params;
    const setting = await getBusinessSetting(ctx.orgId, key);
    if (!setting) throw notFound("Business setting not found");
    return jsonOk({ setting });
  })(req);
}

// DELETE /api/business-settings/[key] — ADMIN-only.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { key } = await params;
    const existing = await getBusinessSetting(ctx.orgId, key);
    if (!existing) throw notFound("Business setting not found");
    await deleteBusinessSetting(ctx.orgId, key);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "business_setting.deleted",
      target: `${ctx.orgId}:${key}`,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
