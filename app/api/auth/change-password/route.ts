import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { changePassword } from "@/lib/services/auth-account";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    const body = await readJson<{
      currentPassword?: string;
      newPassword?: string;
    }>(req);
    if (!body.currentPassword || !body.newPassword) {
      throw new DomainError("Current and new passwords are required", 400);
    }
    await changePassword(
      ctx.userId,
      ctx.sessionId,
      body.currentPassword,
      body.newPassword,
    );
    await db.user.update({
      where: { id: ctx.userId },
      data: { mustChangePassword: false },
    });
    return jsonOk({ ok: true });
  })(req);
}
