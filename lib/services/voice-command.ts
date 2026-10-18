import { db } from "@/lib/db";

export interface CreateVoiceCommandInput {
  orgId: string;
  userId: string;
  command: string;
  intent: string;
  entities?: string;
  confidence?: number;
}

export interface UpdateVoiceCommandInput {
  intent?: string;
  entities?: string;
  confidence?: number;
  status?: "RECEIVED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
}

export async function createVoiceCommand(input: CreateVoiceCommandInput) {
  return db.voiceCommand.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      command: input.command,
      intent: input.intent,
      entities: input.entities ?? "{}",
      confidence: input.confidence ?? 0,
    },
  });
}

export async function getVoiceCommand(id: string) {
  return db.voiceCommand.findUnique({
    where: { id },
  });
}

export async function getVoiceCommands(orgId: string, filters?: {
  userId?: string;
  status?: string;
}) {
  return db.voiceCommand.findMany({
    where: {
      orgId,
      ...(filters?.userId ? { userId: filters.userId } : undefined),
      ...(filters?.status ? { status: filters.status } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateVoiceCommand(id: string, input: UpdateVoiceCommandInput) {
  return db.voiceCommand.update({
    where: { id },
    data: input,
  });
}

export async function deleteVoiceCommand(id: string) {
  return db.voiceCommand.delete({
    where: { id },
  });
}
