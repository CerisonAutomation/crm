import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { previewPartyMergeRoot } from "@/lib/duplicate-merge/composition";

export const dynamic = "force-dynamic";

// GET /api/parties/duplicates/[id]/preview?survivor=&absorbed= — read-only
// merge projection for the pre-confirm screen (fills, moves, tombstone).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);
    const survivorId = url.searchParams.get("survivor") ?? "";
    const absorbedId = url.searchParams.get("absorbed") ?? "";
    if (!survivorId || !absorbedId)
      throw new DomainError(
        "survivor and absorbed query params are required",
        400
      );
    const res = await previewPartyMergeRoot(ctx.orgId, survivorId, absorbedId);
    if (!res.ok) {
      const notFound =
        res.error.indexOf("not found") >= 0 ||
        res.error.indexOf("organisation") >= 0;
      throw new DomainError(res.error, notFound ? 404 : 400);
    }
    return jsonOk({
      plan: res.plan,
      absorbedExternalIdentities: res.absorbedExternalIdentities,
      absorbedConversations: res.absorbedConversations,
    });
  })(req);
}
