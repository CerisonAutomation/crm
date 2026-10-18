import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/ops/tick — staff automation clock. One pass: fire due SCHEDULED
// reminders (→FIRED) and surface counts. Point an external cron here; safe to
// call from several schedulers (idempotent per-run, never throws mid-pass).
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    // Firing reminders is a WRITE — the reminder lifecycle capability, not a
    // read. The read capability is held by the read-only AUDITOR, who must
    // never be able to advance reminder state.
    requireCapability(ctx, "reminder.manage");
    const now = new Date();
    const due = await db.reminder.findMany({
      where: { status: "SCHEDULED", dueAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    let fired = 0;
    for (const row of due) {
      const res = await db.reminder.updateMany({ where: { id: row.id, status: "SCHEDULED" }, data: { status: "FIRED", firedAt: now } });
      fired += res.count;
    }
    await audit({ orgId: ctx.orgId, action: "ops.tick", target: "reminder-queue", actorId: ctx.userId, actorLabel: ctx.name, after: { fired, scanned: due.length } });
    return jsonOk({ fired, scanned: due.length, at: now.toISOString() });
  })(req);
}
