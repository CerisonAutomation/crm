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
import { registerAccount } from "@/lib/services/auth-account";
import { hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
    const gate = hit(`auth:register:${ip}`, 10, 3_600_000);
    if (!gate.allowed)
      throw new DomainError("Too many attempts. Try again later.", 429);
    const body = await readJson<{
      name?: string;
      email?: string;
      password?: string;
      locale?: string;
      consent?: boolean;
    }>(req);
    if (!body.name?.trim() || !body.email?.trim() || !body.password) {
      throw new DomainError("Name, email and password are required", 400);
    }
    const meta = requestMeta(req);
    const result = await registerAccount({
      name: body.name,
      email: body.email,
      password: body.password,
      locale: body.locale,
      consent: body.consent ?? false,
      ip: meta.ipAddress ?? ip,
    });
    const { token } = await createSession(result.userId, {
      authProvider: "password",
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress ?? ip,
    });
    const user = await db.user.findUnique({ where: { id: result.userId } });
    if (!user) throw new DomainError("Registration failed", 500);
    const res = jsonOk({
      user: toSessionUser(user),
      token,
      verification: result.verification,
    });
    setSessionCookie(res, token);
    return res;
  })(req);
}
