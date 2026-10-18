import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteVoiceCommand, getVoiceCommand, updateVoiceCommand } from "@/lib/services/voice-command";
import { notFound } from "@/lib/api-errors";

async function ownedCommand(id: string, orgId: string, userId: string) {
  const voiceCommand = await getVoiceCommand(id);
  if (!voiceCommand || voiceCommand.userId !== userId || voiceCommand.orgId !== orgId) {
    throw notFound("Voice command not found");
  }
  return voiceCommand;
}

// PATCH /api/voice/commands/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    await ownedCommand(id, ctx.orgId, ctx.userId);
    const body = await readJson<{
      intent?: string;
      entities?: string;
      confidence?: number;
      status?: "RECEIVED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
    }>(r);
    const voiceCommand = await updateVoiceCommand(id, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "voice_command.updated",
      target: voiceCommand.id,
      after: body,
      correlationId,
    });
    return jsonOk({ command: voiceCommand });
  })(req);
}

// DELETE /api/voice/commands/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    await ownedCommand(id, ctx.orgId, ctx.userId);
    await deleteVoiceCommand(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "voice_command.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
