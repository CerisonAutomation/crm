import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createVoiceCommand, getVoiceCommands } from "@/lib/services/voice-command";
import { validationFailed } from "@/lib/api-errors";

// GET /api/voice/commands — the caller's own voice command history.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const commands = await getVoiceCommands(ctx.orgId, { userId: ctx.userId });
    return jsonOk({ commands });
  })(req);
}

// POST /api/voice/commands
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      command?: string;
      intent?: string;
      entities?: string;
      confidence?: number;
    }>(r);
    if (!body?.command) throw validationFailed("command is required");
    if (!body?.intent) throw validationFailed("intent is required");
    const voiceCommand = await createVoiceCommand({
      orgId: ctx.orgId,
      userId: ctx.userId,
      command: body.command,
      intent: body.intent,
      entities: body.entities,
      confidence: body.confidence,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "voice_command.created",
      target: voiceCommand.id,
      after: { intent: voiceCommand.intent },
      correlationId,
    });
    return jsonOk({ command: voiceCommand }, 201);
  })(req);
}
