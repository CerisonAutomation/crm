import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  endMeeting,
  getMeeting,
  joinMeeting,
  leaveMeeting,
  meetingConsent,
  setParticipantState,
} from "@/lib/services/meetings";

// GET /api/meetings/[id] — { meeting, side }.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const result = await getMeeting(ctx, id);
    const consent = await meetingConsent(ctx, id);
    return jsonOk({ ...result, consent });
  })(req);
}

// POST /api/meetings/[id] — { action: join|leave|end|state, micOn?, cameraOn?, reason? }.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action?: string;
      micOn?: boolean;
      cameraOn?: boolean;
      reason?: string;
    }>(r);

    if (body.action === "join")
      return jsonOk({ meeting: await joinMeeting(ctx, id) });
    if (body.action === "leave")
      return jsonOk({ meeting: await leaveMeeting(ctx, id) });
    if (body.action === "end")
      return jsonOk({ meeting: await endMeeting(ctx, id, body.reason) });
    if (body.action === "state") {
      return jsonOk({
        meeting: await setParticipantState(ctx, id, {
          micOn: body.micOn,
          cameraOn: body.cameraOn,
        }),
      });
    }
    throw new DomainError("action must be join, leave, end or state", 400);
  })(req);
}
