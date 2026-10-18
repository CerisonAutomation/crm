import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  actOnCall,
  getCallForUser,
  getCallTranscript,
  saveCallTranscript,
} from "@/lib/services/calls";

const ACTIONS = ["answer", "decline", "end"] as const;
type CallAction = (typeof ACTIONS)[number];

// GET /api/calls/[id] — the call, the caller's side, and the saved transcript.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const result = await getCallForUser(ctx, id);
    const transcript = await getCallTranscript(ctx, id);
    return jsonOk({ ...result, ...transcript });
  })(req);
}

// POST /api/calls/[id] — { action } — answer, decline or end a call.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ action?: string }>(r);
    if (!body.action || !(ACTIONS as readonly string[]).includes(body.action)) {
      throw new DomainError("action must be answer, decline or end", 400);
    }
    const call = await actOnCall(ctx, id, body.action as CallAction);
    return jsonOk({ call });
  })(req);
}

// PATCH /api/calls/[id] — { transcript?, recordingRequested?, consentGiven? } —
// transcript autosave + recording-consent flag + this side's dual-consent ack
// (participants only; server-validated, server-stamped).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      transcript?: unknown;
      recordingRequested?: unknown;
      consentGiven?: unknown;
    }>(r);
    if (body.transcript !== undefined && typeof body.transcript !== "string") {
      throw new DomainError("transcript must be a string", 400);
    }
    if (
      body.recordingRequested !== undefined &&
      typeof body.recordingRequested !== "boolean"
    ) {
      throw new DomainError("recordingRequested must be a boolean", 400);
    }
    if (
      body.consentGiven !== undefined &&
      typeof body.consentGiven !== "boolean"
    ) {
      throw new DomainError("consentGiven must be a boolean", 400);
    }
    const saved = await saveCallTranscript(ctx, id, {
      transcript: body.transcript,
      recordingRequested: body.recordingRequested,
      consentGiven: body.consentGiven,
    });
    return jsonOk(saved);
  })(req);
}
