import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { listTeamMessages, postTeamMessage } from "@/lib/services/teams";

// GET /api/teams/[id]/messages?after=&limit= — ascending messages + read watermark.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const sp = new URL(r.url).searchParams;
    const after = sp.get("after") ?? undefined;
    const limitRaw = sp.get("limit");
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const limit = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
    const result = await listTeamMessages(ctx, id, { after, limit });
    return jsonOk(result);
  })(req);
}

// POST /api/teams/[id]/messages — { body?, kind?, audioBase64?, audioMime?, audioDurationMs?, transcript? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      body?: string;
      kind?: string;
      audioBase64?: string;
      audioMime?: string;
      audioDurationMs?: number;
      transcript?: string;
    }>(r);
    const message = await postTeamMessage(ctx, id, body);
    return jsonOk({ message }, 201);
  })(req);
}
