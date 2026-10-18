import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createVoiceNote, getVoiceNotes } from "@/lib/services/voice-note";
import { validationFailed } from "@/lib/api-errors";

// GET /api/voice/notes?caseId= — the caller's own voice notes.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const caseId = new URL(r.url).searchParams.get("caseId") || undefined;
    const notes = await getVoiceNotes(ctx.orgId, { userId: ctx.userId, caseId });
    return jsonOk({ notes });
  })(req);
}

// POST /api/voice/notes
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      audioKey?: string;
      audioMime?: string;
      audioBytes?: number;
      audioDurationMs?: number;
      caseId?: string;
    }>(r);
    if (!body?.audioKey) throw validationFailed("audioKey is required");
    const note = await createVoiceNote({
      orgId: ctx.orgId,
      userId: ctx.userId,
      audioKey: body.audioKey,
      audioMime: body.audioMime,
      audioBytes: body.audioBytes,
      audioDurationMs: body.audioDurationMs,
      caseId: body.caseId,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "voice_note.created",
      target: note.id,
      after: { caseId: note.caseId ?? null },
      correlationId,
    });
    return jsonOk({ note }, 201);
  })(req);
}
