import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteHumanTask, getHumanTask, updateHumanTask } from "@/lib/services/human-task";
import { notFound } from "@/lib/api-errors";

async function ownedTask(id: string, orgId: string) {
  const task = await getHumanTask(id);
  if (!task || task.orgId !== orgId) throw notFound("Human task not found");
  return task;
}

// GET /api/human-tasks/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const task = await ownedTask(id, ctx.orgId);
    return jsonOk({ task });
  })(req);
}

// PATCH /api/human-tasks/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedTask(id, ctx.orgId);
    const body = await readJson<{
      title?: string;
      description?: string;
      status?: "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
      priority?: "LOW" | "MEDIUM" | "HIGH";
      assigneeId?: string;
      dueDate?: string;
    }>(r);
    const task = await updateHumanTask(id, {
      title: body?.title,
      description: body?.description,
      status: body?.status,
      priority: body?.priority,
      assigneeId: body?.assigneeId,
      dueDate: body?.dueDate ? new Date(body.dueDate) : undefined,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "human_task.updated",
      target: task.id,
      after: body,
      correlationId,
    });
    return jsonOk({ task });
  })(req);
}

// DELETE /api/human-tasks/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedTask(id, ctx.orgId);
    await deleteHumanTask(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "human_task.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
