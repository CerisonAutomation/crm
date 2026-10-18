import { db } from "@/lib/db";

export interface CreateVoiceNoteInput {
  orgId: string;
  userId: string;
  caseId?: string;
  audioKey: string;
  audioMime?: string;
  audioBytes?: number;
  audioDurationMs?: number;
}

export interface UpdateVoiceNoteInput {
  transcript?: string;
  transcriptStatus?: "NONE" | "PENDING" | "READY" | "FAILED";
}

export async function createVoiceNote(input: CreateVoiceNoteInput) {
  return db.voiceNote.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      caseId: input.caseId,
      audioKey: input.audioKey,
      audioMime: input.audioMime ?? "audio/webm",
      audioBytes: input.audioBytes ?? 0,
      audioDurationMs: input.audioDurationMs ?? 0,
    },
  });
}

export async function getVoiceNote(id: string) {
  return db.voiceNote.findUnique({
    where: { id },
  });
}

export async function getVoiceNotes(orgId: string, filters?: {
  userId?: string;
  caseId?: string;
  transcriptStatus?: string;
}) {
  return db.voiceNote.findMany({
    where: {
      orgId,
      ...(filters?.userId ? { userId: filters.userId } : undefined),
      ...(filters?.caseId ? { caseId: filters.caseId } : undefined),
      ...(filters?.transcriptStatus ? { transcriptStatus: filters.transcriptStatus } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateVoiceNote(id: string, input: UpdateVoiceNoteInput) {
  return db.voiceNote.update({
    where: { id },
    data: input,
  });
}

export async function deleteVoiceNote(id: string) {
  return db.voiceNote.delete({
    where: { id },
  });
}
