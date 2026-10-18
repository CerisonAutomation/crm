import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";
import { getFindings } from "@/lib/services/reconciliation";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const findings = await getFindings(id, ctx.orgId);
    return jsonOk({ findings });
  })(req);
}
