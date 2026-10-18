import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/automation/jobs — list jobs with optional status filter
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");

    const { searchParams } = new URL(r.url);
    const status = searchParams.get("status");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

    const jobs = await db.automationJob.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        topic: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        correlationId: true,
        createdAt: true,
        finishedAt: true,
        claimedAt: true,
        claimedBy: true,
        notBefore: true,
        leaseUntil: true,
        concurrencyKey: true,
        workerClass: true,
        failureCategory: true,
      },
    });

    return jsonOk({ jobs });
  })(req);
}
