import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/ops/alerts — staff operational watchlist: stale cases, expiring
// documents, due/escalated reminders, open approval letters.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const staleSince = new Date(Date.now() - 7 * 86_400_000);
    const [staleCases, dueReminders, openLetters] = await Promise.all([
      db.case.findMany({
        where: { orgId: ctx.orgId, status: { notIn: ["COMPLETED", "CANCELLED"] }, updatedAt: { lt: staleSince } },
        select: { id: true, reference: true, status: true, updatedAt: true },
        take: 50,
      }),
      db.reminder.findMany({
        where: { case: { orgId: ctx.orgId }, status: { in: ["SCHEDULED", "FIRED"] }, dueAt: { lt: new Date() } },
        select: { id: true, title: true, dueAt: true, status: true },
        take: 50,
      }),
      db.approvalLetter.findMany({
        where: { case: { orgId: ctx.orgId }, approvedBy: null },
        select: { id: true, caseId: true, createdAt: true },
        take: 50,
      }),
    ]);
    return jsonOk({ staleCases, dueReminders, openLetters, generatedAt: new Date().toISOString() });
  })(req);
}
