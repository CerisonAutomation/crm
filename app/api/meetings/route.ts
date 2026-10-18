import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { listMeetings, startMeeting } from "@/lib/services/meetings";

// GET /api/meetings?active=1&teamId=&caseId= — the caller's meetings.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const sp = new URL(r.url).searchParams;
    const meetings = await listMeetings(ctx, {
      active: sp.get("active") === "1",
      teamId: sp.get("teamId") ?? undefined,
      caseId: sp.get("caseId") ?? undefined,
    });
    return jsonOk({ meetings });
  })(req);
}

// POST /api/meetings — { teamId?, caseId?, title?, kind? } — start a meeting (capability-gated).
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ teamId?: string; caseId?: string; title?: string; kind?: string }>(r);
    const meeting = await startMeeting(ctx, body);
    return jsonOk({ meeting }, 201);
  })(req);
}
