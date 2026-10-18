import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { listCalls, startCall } from "@/lib/services/calls";

// GET /api/calls?caseId=&active=1 — the caller's calls (stale rings expire first).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const sp = new URL(r.url).searchParams;
    const caseId = sp.get("caseId") ?? undefined;
    const active = sp.get("active") === "1";
    const calls = await listCalls(ctx, { caseId, active });
    return jsonOk({ calls });
  })(req);
}

// POST /api/calls — { caseId, kind } — start a new call for a case.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ caseId?: string; kind?: string }>(r);
    if (!body.caseId) throw new DomainError("caseId required", 400);
    if (body.kind !== "AUDIO" && body.kind !== "VIDEO") {
      throw new DomainError("kind must be AUDIO or VIDEO", 400);
    }
    const call = await startCall(ctx, body.caseId, body.kind);
    return jsonOk({ call }, 201);
  })(req);
}
