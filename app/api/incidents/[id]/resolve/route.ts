import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { resolveIncident } from "@/lib/services/incident";
import { validationFailed } from "@/lib/api-errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const body = await readJson<{ resolution?: string }>(r);
    const resolution = body?.resolution as string;
    if (!resolution) throw validationFailed("Resolution is required");
    const incident = await resolveIncident(id, ctx.userId, ctx.orgId, resolution);
    return jsonOk({ incident });
  })(req);
}
