import { db } from "@/lib/db";

export interface CreateOfflineQueueInput {
  orgId: string;
  userId: string;
  action: "SUBMIT_FORM" | "UPLOAD_DOCUMENT" | "SEND_MESSAGE" | "UPDATE_PROFILE";
  payload: string;
}

export async function enqueueOfflineAction(input: CreateOfflineQueueInput) {
  return db.offlineQueue.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      payload: input.payload,
    },
  });
}

export async function getOfflineQueueItem(id: string) {
  return db.offlineQueue.findUnique({
    where: { id },
  });
}

export async function getOfflineQueue(orgId: string, filters?: {
  userId?: string;
  status?: string;
}) {
  return db.offlineQueue.findMany({
    where: {
      orgId,
      ...(filters?.userId ? { userId: filters.userId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function markOfflineSyncing(id: string) {
  return db.offlineQueue.update({
    where: { id },
    data: { status: "SYNCING" },
  });
}

export async function markOfflineSucceeded(id: string) {
  return db.offlineQueue.update({
    where: { id },
    data: { status: "SUCCEEDED" },
  });
}

export async function markOfflineFailed(id: string, error: string) {
  const item = await db.offlineQueue.findUnique({ where: { id } });
  return db.offlineQueue.update({
    where: { id },
    data: {
      status: "FAILED",
      lastError: error,
      retryCount: (item?.retryCount ?? 0) + 1,
    },
  });
}

export async function markOfflineConflict(id: string, error: string) {
  return db.offlineQueue.update({
    where: { id },
    data: { status: "CONFLICT", lastError: error },
  });
}

export async function deleteOfflineQueueItem(id: string) {
  return db.offlineQueue.delete({
    where: { id },
  });
}
