import { db } from "@/lib/db";

export interface CreatePollCheckpointInput {
  connectionId: string;
  cursor: string;
  highWaterMark?: string;
  nextRun?: Date;
}

export interface UpdatePollCheckpointInput {
  cursor?: string;
  highWaterMark?: string;
  lastSuccess?: Date;
  nextRun?: Date;
  failureCount?: number;
  lease?: string | null;
  pauseReason?: string | null;
  status?: "active" | "paused" | "failed";
}

export async function createPollCheckpoint(input: CreatePollCheckpointInput) {
  return db.pollCheckpoint.create({
    data: {
      connectionId: input.connectionId,
      cursor: input.cursor,
      highWaterMark: input.highWaterMark,
      nextRun: input.nextRun ?? new Date(),
    },
  });
}

export async function getPollCheckpoint(id: string) {
  return db.pollCheckpoint.findUnique({
    where: { id },
    include: { connection: true },
  });
}

export async function getPollCheckpoints(connectionId: string) {
  return db.pollCheckpoint.findMany({
    where: { connectionId },
    orderBy: { nextRun: "asc" },
  });
}

export async function getDuePollCheckpoints(now: Date = new Date()) {
  return db.pollCheckpoint.findMany({
    where: {
      status: "active",
      nextRun: { lte: now },
    },
    orderBy: { nextRun: "asc" },
  });
}

export async function updatePollCheckpoint(id: string, input: UpdatePollCheckpointInput) {
  return db.pollCheckpoint.update({
    where: { id },
    data: input,
  });
}

export async function recordPollSuccess(
  id: string,
  cursor: string,
  highWaterMark: string | undefined,
  nextRun: Date
) {
  return db.pollCheckpoint.update({
    where: { id },
    data: {
      cursor,
      highWaterMark,
      lastSuccess: new Date(),
      nextRun,
      failureCount: 0,
      lease: null,
      status: "active",
    },
  });
}

export async function recordPollFailure(id: string, pauseReason?: string) {
  const checkpoint = await db.pollCheckpoint.findUnique({ where: { id } });
  const failureCount = (checkpoint?.failureCount ?? 0) + 1;
  return db.pollCheckpoint.update({
    where: { id },
    data: {
      failureCount,
      lease: null,
      ...(pauseReason ? { status: "paused", pauseReason } : {}),
    },
  });
}

export async function deletePollCheckpoint(id: string) {
  return db.pollCheckpoint.delete({
    where: { id },
  });
}
