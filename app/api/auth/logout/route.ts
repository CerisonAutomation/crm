import { NextRequest } from "next/server";
import { clearSessionCookie, requireAuth, revokeSession } from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    await revokeSession(ctx.sessionId, "logout");
    const res = jsonOk({ ok: true });
    clearSessionCookie(res);
    return res;
  })(req);
}
