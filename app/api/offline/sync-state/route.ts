import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { upsertSyncState, getSyncStates } from "@/lib/services/sync-state";
import { validationFailed } from "@/lib/api-errors";

// GET /api/offline/sync-state — the caller's own sync cursors.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const entityType = new URL(r.url).searchParams.get("entityType") || undefined;
    const states = await getSyncStates(ctx.orgId, { userId: ctx.userId, entityType });
    return jsonOk({ states });
  })(req);
}

// POST /api/offline/sync-state — record/refresh a sync cursor for one entity.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      entityType?: "CASE" | "DOCUMENT" | "MESSAGE" | "PROFILE";
      entityId?: string;
      syncToken?: string;
    }>(r);
    if (!body?.entityType) throw validationFailed("entityType is required");
    if (!body?.entityId) throw validationFailed("entityId is required");
    const state = await upsertSyncState({
      orgId: ctx.orgId,
      userId: ctx.userId,
      entityType: body.entityType,
      entityId: body.entityId,
      syncToken: body.syncToken,
    });
    return jsonOk({ state });
  })(req);
}
