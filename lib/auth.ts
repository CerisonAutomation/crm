import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { DomainError, can, type Role } from "@/lib/domain/states";

export const SESSION_COOKIE = "cl_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const LAST_ACTIVE_TOUCH_MS = 1000 * 60 * 5;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export function hashSessionToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createSession(
  userId: string,
  opts?: {
    authProvider?: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
) {
  const token = randomBytes(32).toString("hex");
  const session = await db.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      authProvider: opts?.authProvider ?? "password",
      userAgent: opts?.userAgent ?? null,
      ipAddress: opts?.ipAddress ?? null,
      lastActiveAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { session, token };
}

export async function revokeSession(
  sessionId: string,
  reason: string,
): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export type AuthContext = {
  userId: string;
  role: Role;
  orgId: string;
  email: string;
  name: string;
  sessionId: string;
};

/**
 * Resolve the acting user from the session cookie OR an Authorization bearer token.
 *
 * Why the bearer fallback: the sandbox preview panel (and some SSO portals) render the
 * app inside a cross-origin iframe, where browsers refuse to store or send SameSite=Lax
 * cookies for API calls. Headers are not subject to SameSite rules, so the client keeps
 * the session token in sessionStorage and sends `Authorization: Bearer <token>`.
 * Throws 401 DomainError when absent/revoked/expired.
 */
export function extractSessionToken(req: NextRequest): string | undefined {
  const cookieToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookieToken) return cookieToken;
  const header = req.headers.get("authorization");
  if (header && /^bearer\s+/i.test(header)) {
    const value = header.replace(/^bearer\s+/i, "").trim();
    if (value) return value;
  }
  return undefined;
}

export async function requireAuth(req: NextRequest): Promise<AuthContext> {
  const token = extractSessionToken(req);
  if (!token) throw new DomainError("Authentication required", 401);
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new DomainError("Session invalid or revoked", 401);
  }
  const u = session.user;
  if (u.status === "DEACTIVATED")
    throw new DomainError("Account deactivated", 403);
  const now = new Date();
  if (
    !session.lastActiveAt ||
    now.getTime() - session.lastActiveAt.getTime() > LAST_ACTIVE_TOUCH_MS
  ) {
    await db.session.update({
      where: { id: session.id },
      data: { lastActiveAt: now },
    });
  }
  return {
    userId: u.id,
    role: u.role as Role,
    orgId: u.orgId,
    email: u.email,
    name: u.name,
    sessionId: session.id,
  };
}

/** Deny-by-default capability check. */
export function requireCapability(ctx: AuthContext, capability: string) {
  if (!can(ctx.role, capability)) {
    throw new DomainError(`Forbidden: missing capability ${capability}`, 403);
  }
}

export function actorLabel(ctx: AuthContext): string {
  return `${ctx.name} <${ctx.email}> [${ctx.role}]`;
}

export type SessionUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  profileState: string;
  emailVerifiedAt: Date | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
};

export function toSessionUser(u: SessionUserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    profileState: u.profileState,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    firstName: u.firstName,
    lastName: u.lastName,
    dateOfBirth: u.dateOfBirth,
    nationality: u.nationality,
    phone: u.phone,
    address: u.address,
    city: u.city,
    country: u.country,
  };
}

export function sessionCookieAttributes(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieAttributes(SESSION_TTL_MS / 1000),
  );
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", sessionCookieAttributes(0));
}

export function requestMeta(req: NextRequest): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    ipAddress: forwarded || req.headers.get("x-real-ip")?.trim() || null,
  };
}

export function newCorrelationId() {
  return `cor_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}
