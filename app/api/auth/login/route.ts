import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  createSession,
  requestMeta,
  setSessionCookie,
  toSessionUser,
  verifyPassword,
} from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
    const gate = hit(`auth:login:${ip}`, 20, 15 * 60 * 1000);
    if (!gate.allowed)
      throw new DomainError("Too many attempts. Try again later.", 429);
    const body = await readJson<{ email?: string; password?: string }>(req);
    const email = body.email?.toLowerCase().trim() ?? "";
    if (!email || !body.password) {
      throw new DomainError("Email and password are required", 400);
    }
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw new DomainError("Invalid email or password", 401);
    }
    if (user.status === "DEACTIVATED") {
      throw new DomainError("Account deactivated", 403);
    }
    const meta = requestMeta(req);
    const { token } = await createSession(user.id, {
      authProvider: "password",
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress ?? ip,
    });
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const res = jsonOk({ user: toSessionUser(user), token });
    setSessionCookie(res, token);
    return res;
  })(req);
}
