import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, actorLabel } from "@/lib/api-helpers";
import { pauseSLA } from "@/lib/services/sla";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const body = await readJson<{ reason?: unknown }>(r);
    // Declared-reason enum enforced in the service (400 on anything else).
    const clock = await pauseSLA(id, ctx.orgId, body?.reason, actorLabel(ctx));
    return jsonOk({ clock });
  })(req);
}
