import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  createSession,
  requestMeta,
  setSessionCookie,
  toSessionUser,
} from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { consumeMagicLink } from "@/lib/services/auth-account";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const body = await readJson<{ token?: string }>(req);
    if (!body.token) throw new DomainError("Sign-in token is required", 400);
    const account = await consumeMagicLink(body.token);
    if (!account)
      throw new DomainError("This sign-in link is invalid or has expired", 401);
    const meta = requestMeta(req);
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
    const { token } = await createSession(account.userId, {
      authProvider: "magic_link",
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress ?? ip,
    });
    const user = await db.user.update({
      where: { id: account.userId },
      data: {
        lastLoginAt: new Date(),
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
      },
    });
    const res = jsonOk({ user: toSessionUser(user), token });
    setSessionCookie(res, token);
    return res;
  })(req);
}
