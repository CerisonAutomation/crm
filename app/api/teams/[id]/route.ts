import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { getTeam, updateTeam } from "@/lib/services/teams";

// GET /api/teams/[id] — { team, members } (staff member or ADMIN).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const result = await getTeam(ctx, id);
    return jsonOk(result);
  })(req);
}

// PATCH /api/teams/[id] — { name?, description?, kind?, archived? } — update (ADMIN).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ name?: string; description?: string; kind?: string; archived?: boolean }>(r);
    const team = await updateTeam(ctx, id, body);
    return jsonOk({ team });
  })(req);
}
