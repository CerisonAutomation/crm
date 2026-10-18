import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, actorLabel } from "@/lib/api-helpers";
import { resumeSLA } from "@/lib/services/sla";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    // Breach recalculation happens in the service: deadlineAt shifts by the
    // paused span, audited with the new deadline.
    const clock = await resumeSLA(id, ctx.orgId, actorLabel(ctx));
    return jsonOk({ clock });
  })(req);
}
