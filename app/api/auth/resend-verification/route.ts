import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { extractSessionToken, hashSessionToken } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { sendVerification } from "@/lib/services/auth-account";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const body = await readJson<{ email?: string }>(req);
    let user: Awaited<ReturnType<typeof db.user.findUnique>> = null;
    const token = extractSessionToken(req);
    if (token) {
      const session = await db.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
        include: { user: true },
      });
      if (session && !session.revokedAt && session.expiresAt >= new Date()) {
        user = session.user;
      }
    }
    if (!user && body.email?.trim()) {
      user = await db.user.findUnique({
        where: { email: body.email.toLowerCase().trim() },
      });
    }
    if (!user) return jsonOk({ ok: true });
    if (user.emailVerifiedAt)
      return jsonOk({ ok: true, alreadyVerified: true });
    const verification = await sendVerification({
      userId: user.id,
      email: user.email,
      name: user.name,
      locale: "en",
    });
    return jsonOk({ ok: true, verification });
  })(req);
}
