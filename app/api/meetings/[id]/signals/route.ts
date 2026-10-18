import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { appendMeetingSignal, meetingSignalsAfter } from "@/lib/services/meetings";

// GET /api/meetings/[id]/signals?after=<seq> — peer signals + participant roster.
// Participant-only; a peer only reads rows addressed to it (or broadcast).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const raw = new URL(r.url).searchParams.get("after");
    const parsed = Number.parseInt(raw ?? "0", 10);
    const after = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const result = await meetingSignalsAfter(ctx, id, after);
    return jsonOk(result);
  })(req);
}

// POST /api/meetings/[id]/signals — { toUserId, kind, payload } — append a signal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ toUserId?: string | null; kind?: string; payload?: Record<string, unknown> }>(r);
    if (!body.kind) throw new DomainError("kind required", 400);
    const result = await appendMeetingSignal(ctx, id, {
      toUserId: body.toUserId ?? null,
      kind: body.kind,
      payload: body.payload ?? {},
    });
    return jsonOk(result);
  })(req);
}
