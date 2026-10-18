import { NextRequest } from "next/server";
import {
  clearSessionCookie,
  extractSessionToken,
  hashSessionToken,
  toSessionUser,
} from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handler(async () => {
    const token = extractSessionToken(req);
    if (!token) return jsonOk({ user: null });
    const session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.user.status === "DEACTIVATED"
    ) {
      const res = jsonOk({ user: null });
      clearSessionCookie(res);
      return res;
    }
    return jsonOk({ user: toSessionUser(session.user) });
  })(req);
}
