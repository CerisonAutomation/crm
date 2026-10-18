import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { createTeam, listTeams } from "@/lib/services/teams";

// GET /api/teams — the caller's teams (membership-scoped; ADMIN sees the org).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const teams = await listTeams(ctx);
    return jsonOk({ teams });
  })(req);
}

// POST /api/teams — { name, description?, kind?, memberIds? } — create a team (ADMIN).
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ name?: string; description?: string; kind?: string; memberIds?: string[] }>(r);
    if (!body.name || typeof body.name !== "string") throw new DomainError("name required", 400);
    if (body.memberIds !== undefined && !Array.isArray(body.memberIds)) {
      throw new DomainError("memberIds must be an array", 400);
    }
    const team = await createTeam(ctx, {
      name: body.name,
      description: body.description,
      kind: body.kind,
      memberIds: body.memberIds,
    });
    return jsonOk({ team }, 201);
  })(req);
}
