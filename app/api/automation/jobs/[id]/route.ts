import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { notFound } from "@/lib/api-errors";
import { requireAuth, requireCapability } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/automation/jobs/[id] — single job with full timeline
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");

    const { id } = await params;
    const job = await db.automationJob.findUnique({
      where: { id },
      select: {
        id: true,
        topic: true,
        payload: true,
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
        orgId: true,
        leaseUntil: true,
        concurrencyKey: true,
        workerClass: true,
        failureCategory: true,
      },
    });

    // Object-level authorization: a job belongs to one organisation. The
    // workflow.write capability proves the caller may read automation jobs in
    // general — it says nothing about THIS tenant's job, so the org must match
    // or the row is treated as non-existent (no cross-tenant existence leak).
    if (!job || job.orgId !== ctx.orgId) throw notFound("Automation job not found");

    const attempts = await db.automationAttempt.findMany({
      where: { jobId: id },
      orderBy: { attempt: "asc" },
      select: {
        id: true,
        attempt: true,
        workerId: true,
        status: true,
        failureCategory: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
      },
    });

    // Build timeline from available fields
    const timeline: Array<{ at: string; event: string; detail?: string }> = [
      { at: job.createdAt.toISOString(), event: "Job created", detail: job.topic },
    ];

    if (job.claimedAt) {
      timeline.push({
        at: job.claimedAt.toISOString(),
        event: "Job claimed",
        detail: job.claimedBy ? `by ${job.claimedBy}` : undefined,
      });
    }

    if (job.finishedAt) {
      timeline.push({
        at: job.finishedAt.toISOString(),
        event: job.status === "SUCCEEDED" ? "Job succeeded" : "Job failed",
        detail: job.lastError ?? undefined,
      });
    }

    return jsonOk({ job, timeline, attempts });
  })(req);
}
