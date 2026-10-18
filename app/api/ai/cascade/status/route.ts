import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { getCascadeStatus } from "../route";

/**
 * GET /api/ai/cascade/status — check if cloud AI is available.
 * Authenticated: reveals server config state (provider wiring), so a
 * credential is required like every other non-public route.
 * Shares the handler with GET /api/ai/cascade so both paths stay identical.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    await requireAuth(r);
    return jsonOk(await getCascadeStatus());
  })(req);
}
