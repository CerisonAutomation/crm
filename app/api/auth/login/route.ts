import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  createSession,
  requestMeta,
  setSessionCookie,
  toSessionUser,
  verifyPassword,
} from "@/lib/auth";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const LOCKOUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  return handler(async () => {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";

    // The body can only be read once — reading it a second time throws and
    // turns every sign-in attempt into "Invalid JSON body".
    const body = await readJson<{ email?: string; password?: string }>(req);
    const email = body.email?.toLowerCase().trim() ?? "";

    // Account lockout: count this account's recent failures in the audit trail
    // and enforce progressive thresholds. Scoped by target so failures against
    // one account can never lock every account out.
    if (email) {
      const recentFailures = await db.auditEvent.count({
        where: {
          action: "auth.login.failed",
          target: `email:${email}`,
          createdAt: { gte: new Date(Date.now() - LOCKOUT_WINDOW_MS) },
        },
      });
      if (recentFailures >= 15) {
        await audit({
          action: "auth.login.failed",
          target: `email:${email}`, // limited info for privacy, just enough for lockout
          reason: `Account lockout: ${recentFailures} failed attempts in 7d (ip:${ip})`,
          correlationId: undefined, // could add from header if available
        });
        throw new DomainError(
          "Account temporarily locked due to too many failed login attempts. Try again later or use password reset.",
          429,
        );
      }
      if (recentFailures >= 10) {
        await audit({
          action: "auth.login.failed",
          target: `email:${email}`, // limited info for privacy, just enough for lockout
          reason: `High failure rate: ${recentFailures} failed attempts in 7d (ip:${ip})`,
          correlationId: undefined, // could add from header if available
        });
      }
      if (recentFailures >= 5) {
        await audit({
          action: "auth.login.failed",
          target: `email:${email}`, // limited info for privacy, just enough for lockout
          reason: `Multiple failures: ${recentFailures} failed attempts in 7d (ip:${ip})`,
          correlationId: undefined, // could add from header if available
        });
      }
    }

    const gate = hit(`auth:login:${ip}`, 20, 15 * 60 * 1000);
    if (!gate.allowed)
      throw new DomainError("Too many attempts. Try again later.", 429);

    if (!email || !body.password) {
      // Record failed attempt in audit trail
      await audit({
        action: "auth.login.failed",
        target: `email:${email}`, // limited info for privacy
        reason: "Missing email or password",
        correlationId: undefined, // could add from header if available
      });
      throw new DomainError("Email and password are required", 400);
    }
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      // Record failed attempt in audit trail
      await audit({
        action: "auth.login.failed",
        target: `email:${email}`, // limited info for privacy
        reason: "Invalid email or password",
        correlationId: undefined, // could add from header if available
      });
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
