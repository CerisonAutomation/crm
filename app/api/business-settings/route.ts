import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { getBusinessSettings, setBusinessSetting } from "@/lib/services/business-setting";
import { validationFailed } from "@/lib/api-errors";

// GET /api/business-settings — ADMIN-only organisation settings.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const settings = await getBusinessSettings(ctx.orgId);
    return jsonOk({ settings });
  })(req);
}

// POST /api/business-settings — upsert one setting.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{ key?: string; value?: string }>(r);
    if (!body?.key) throw validationFailed("key is required");
    if (body?.value === undefined) throw validationFailed("value is required");
    const setting = await setBusinessSetting({
      orgId: ctx.orgId,
      key: body.key,
      value: body.value,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "business_setting.set",
      target: `${setting.orgId}:${setting.key}`,
      after: { key: setting.key },
      correlationId,
    });
    return jsonOk({ setting });
  })(req);
}
