import { NextRequest, NextResponse } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  readMeetingRecording,
  saveMeetingTranscript,
  storeMeetingRecording,
} from "@/lib/services/meetings";

// GET /api/meetings/[id]/recording — stream the vault-stored recording.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const { bytes, mime } = await readMeetingRecording(ctx, id);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": mime,
        "content-disposition": "inline",
        "cache-control": "private, no-store",
        "content-length": String(bytes.length),
      },
    });
  })(req);
}

// POST /api/meetings/[id]/recording — { audioBase64, mime, durationMs } — host/ADMIN only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      audioBase64?: string;
      mime?: string;
      durationMs?: number;
      consentGiven?: unknown;
    }>(r);
    if (!body.audioBase64) throw new DomainError("audioBase64 required", 400);
    if (body.consentGiven !== true)
      throw new DomainError(
        "Recording consent required: consentGiven must be true",
        400
      );
    const result = await storeMeetingRecording(ctx, id, {
      audioBase64: body.audioBase64,
      mime: body.mime,
      durationMs: body.durationMs,
      consentGiven: true,
    });
    return jsonOk({ ok: true, bytes: result.bytes });
  })(req);
}

// PATCH /api/meetings/[id]/recording — { transcript } — host/ADMIN saves the transcript.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ transcript?: string }>(r);
    await saveMeetingTranscript(ctx, id, body.transcript ?? "");
    return jsonOk({ ok: true });
  })(req);
}
