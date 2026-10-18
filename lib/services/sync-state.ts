import { db } from "@/lib/db";

export interface UpsertSyncStateInput {
  orgId: string;
  userId: string;
  entityType: "CASE" | "DOCUMENT" | "MESSAGE" | "PROFILE";
  entityId: string;
  syncToken?: string;
}

export async function upsertSyncState(input: UpsertSyncStateInput) {
  return db.syncState.upsert({
    where: {
      userId_entityType_entityId: {
        userId: input.userId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    create: {
      orgId: input.orgId,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      syncToken: input.syncToken,
    },
    update: {
      lastSyncedAt: new Date(),
      syncToken: input.syncToken,
    },
  });
}

export async function getSyncState(userId: string, entityType: string, entityId: string) {
  return db.syncState.findUnique({
    where: {
      userId_entityType_entityId: {
        userId,
        entityType,
        entityId,
      },
    },
  });
}

export async function getSyncStates(orgId: string, filters?: {
  userId?: string;
  entityType?: string;
}) {
  return db.syncState.findMany({
    where: {
      orgId,
      ...(filters?.userId ? { userId: filters.userId } : undefined),
      ...(filters?.entityType ? { entityType: filters.entityType } : undefined),
    },
    orderBy: { lastSyncedAt: "desc" },
  });
}

export async function deleteSyncState(id: string) {
  return db.syncState.delete({
    where: { id },
  });
}
