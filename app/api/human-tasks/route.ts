import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createHumanTask, getHumanTasks } from "@/lib/services/human-task";
import { validationFailed } from "@/lib/api-errors";

// GET /api/human-tasks?caseId=&status=&assigneeId=&priority=
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const tasks = await getHumanTasks(ctx.orgId, {
      caseId: q.get("caseId") || undefined,
      status: q.get("status") || undefined,
      assigneeId: q.get("assigneeId") || undefined,
      priority: q.get("priority") || undefined,
    });
    return jsonOk({ tasks });
  })(req);
}

// POST /api/human-tasks
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      title?: string;
      description?: string;
      priority?: "LOW" | "MEDIUM" | "HIGH";
      assigneeId?: string;
      dueDate?: string;
      caseId?: string;
      runId?: string;
      nodeRunId?: string;
    }>(r);
    if (!body?.title) throw validationFailed("title is required");
    const task = await createHumanTask({
      orgId: ctx.orgId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      caseId: body.caseId,
      runId: body.runId,
      nodeRunId: body.nodeRunId,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "human_task.created",
      target: task.id,
      after: { title: task.title, priority: task.priority },
      correlationId,
    });
    return jsonOk({ task }, 201);
  })(req);
}
