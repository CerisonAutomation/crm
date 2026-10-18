import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";
import { markSLAMet } from "@/lib/services/sla";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const clock = await markSLAMet(id, ctx.orgId);
    return jsonOk({ clock });
  })(req);
}
