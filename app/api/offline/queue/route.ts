import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { enqueueOfflineAction, getOfflineQueue } from "@/lib/services/offline-queue";
import { validationFailed } from "@/lib/api-errors";

// GET /api/offline/queue — the caller's own queued offline actions.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const status = new URL(r.url).searchParams.get("status") || undefined;
    const items = await getOfflineQueue(ctx.orgId, { userId: ctx.userId, status });
    return jsonOk({ items });
  })(req);
}

// POST /api/offline/queue — queue a non-sensitive action for later sync.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action?: "SUBMIT_FORM" | "UPLOAD_DOCUMENT" | "SEND_MESSAGE" | "UPDATE_PROFILE";
      payload?: string;
    }>(r);
    if (!body?.action) throw validationFailed("action is required");
    if (!body?.payload) throw validationFailed("payload is required");
    const item = await enqueueOfflineAction({
      orgId: ctx.orgId,
      userId: ctx.userId,
      action: body.action,
      payload: body.payload,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "offline.queued",
      target: item.id,
      after: { action: item.action },
      correlationId,
    });
    return jsonOk({ item }, 201);
  })(req);
}
