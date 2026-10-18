import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { deleteThread, getThread, listThreads } from "@/lib/ai/context";

/**
 * GET  /api/ai/context           — list the caller's own AI threads.
 * GET  /api/ai/context?id=…      — one of the caller's threads with its messages.
 * DELETE /api/ai/context?id=…    — remove one of the caller's threads.
 *
 * Threads are scoped to the authenticated user (not merely the organisation),
 * so a member of the org can never read or delete another member's threads.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const id = r.nextUrl.searchParams.get("id");
    if (id) {
      const thread = await getThread(ctx.orgId, ctx.userId, id);
      return jsonOk({ thread });
    }
    return jsonOk({ threads: await listThreads(ctx.orgId, ctx.userId) });
  })(req);
}

export async function DELETE(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const id = r.nextUrl.searchParams.get("id") ?? "";
    const deleted = id ? await deleteThread(ctx.orgId, ctx.userId, id) : false;
    return jsonOk({ deleted });
  })(req);
}
