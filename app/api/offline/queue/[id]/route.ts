import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import {
  getOfflineQueueItem,
  markOfflineSyncing,
  markOfflineSucceeded,
  markOfflineFailed,
  markOfflineConflict,
  deleteOfflineQueueItem,
} from "@/lib/services/offline-queue";
import { notFound, validationFailed } from "@/lib/api-errors";

// PATCH /api/offline/queue/[id] — advance the sync state of the caller's own item.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    const existing = await getOfflineQueueItem(id);
    if (!existing || existing.userId !== ctx.userId || existing.orgId !== ctx.orgId) {
      throw notFound("Queue item not found");
    }
    const body = await readJson<{ status?: string; error?: string }>(r);
    const status = body?.status;
    if (!status) throw validationFailed("status is required");

    let item;
    switch (status) {
      case "SYNCING":
        item = await markOfflineSyncing(id);
        break;
      case "SUCCEEDED":
        item = await markOfflineSucceeded(id);
        break;
      case "FAILED":
        item = await markOfflineFailed(id, body?.error ?? "Sync failed");
        break;
      case "CONFLICT":
        item = await markOfflineConflict(id, body?.error ?? "Conflict detected");
        break;
      default:
        throw validationFailed("status must be one of: SYNCING, SUCCEEDED, FAILED, CONFLICT");
    }

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "offline.status_changed",
      target: id,
      after: { status: item.status },
      correlationId,
    });
    return jsonOk({ item });
  })(req);
}

// DELETE /api/offline/queue/[id] — discard the caller's own queued item.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    const existing = await getOfflineQueueItem(id);
    if (!existing || existing.userId !== ctx.userId || existing.orgId !== ctx.orgId) {
      throw notFound("Queue item not found");
    }
    await deleteOfflineQueueItem(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "offline.discarded",
      target: id,
      before: { action: existing.action },
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
