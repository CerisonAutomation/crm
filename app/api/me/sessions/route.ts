import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, revokeSession } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

async function listSessions(userId: string, currentId: string) {
  const now = new Date();
  const rows = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });
  return rows.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentId,
  }));
}

export async function GET(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    return jsonOk({ sessions: await listSessions(ctx.userId, ctx.sessionId) });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    const body = await readJson<{ action?: string; id?: string }>(req);
    let revoked = 0;
    if (body.action === "revoke") {
      if (!body.id) throw new DomainError("Session id is required", 400);
      if (body.id === ctx.sessionId) {
        throw new DomainError("Revoke the current session by signing out", 400);
      }
      const owned = await db.session.findFirst({
        where: { id: body.id, userId: ctx.userId, revokedAt: null },
        select: { id: true },
      });
      if (!owned) throw new DomainError("Session not found", 404);
      await revokeSession(body.id, "revoked_by_user");
      revoked = 1;
    } else if (body.action === "revoke-others") {
      const result = await db.session.updateMany({
        where: {
          userId: ctx.userId,
          revokedAt: null,
          id: { not: ctx.sessionId },
        },
        data: { revokedAt: new Date(), revokedReason: "revoked_others" },
      });
      revoked = result.count;
    } else {
      throw new DomainError("Unknown action", 400);
    }
    return jsonOk({
      revoked,
      sessions: await listSessions(ctx.userId, ctx.sessionId),
    });
  })(req);
}
