import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  handler,
  jsonOk,
  readJson,
  audit,
  actorLabel,
} from "@/lib/api-helpers";
import {
  deleteVoiceNote,
  getVoiceNote,
  updateVoiceNote,
} from "@/lib/services/voice-note";
import { createTask } from "@/lib/services/crm";
import { deriveTranscriptInsights } from "@/lib/ports/transcript-insights";
import { notFound } from "@/lib/api-errors";

async function ownedNote(id: string, orgId: string, userId: string) {
  const note = await getVoiceNote(id);
  if (!note || note.userId !== userId || note.orgId !== orgId) {
    throw notFound("Voice note not found");
  }
  return note;
}

// PATCH /api/voice/notes/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    const prev = await ownedNote(id, ctx.orgId, ctx.userId);
    const body = await readJson<{
      transcript?: string;
      transcriptStatus?: "NONE" | "PENDING" | "READY" | "FAILED";
    }>(r);
    const note = await updateVoiceNote(id, body);
    // TRANSCRIPT slice: on first transition to READY, derive cited action
    // items into case tasks (transition-guarded so retries never duplicate).
    if (
      body.transcriptStatus === "READY" &&
      prev.transcriptStatus !== "READY" &&
      (body.transcript ?? "").trim() !== "" &&
      note.caseId
    ) {
      const transcript = body.transcript as string;
      const { items } = deriveTranscriptInsights(transcript);
      for (const item of items) {
        const cited = item.citations
          .map((c) => '"' + c.quote + '" [' + c.segmentId + "]")
          .join("\n");
        await createTask(ctx.orgId, ctx.userId, {
          title: item.title,
          notes:
            (item.dueHint ? "Due hint: " + item.dueHint + "\n" : "") +
            "From voice note transcript:\n" +
            cited,
          caseId: note.caseId,
        });
      }
      if (items.length > 0) {
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: actorLabel(ctx),
          action: "voice_note.action_items",
          target: note.id,
          after: { count: items.length },
          correlationId,
        });
      }
    }
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "voice_note.updated",
      target: note.id,
      after: body,
      correlationId,
    });
    return jsonOk({ note });
  })(req);
}

// DELETE /api/voice/notes/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    await ownedNote(id, ctx.orgId, ctx.userId);
    await deleteVoiceNote(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "voice_note.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
