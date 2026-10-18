import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const w = await db.workItem.findUnique({
      where: { id: params.id },
      include: { case: { select: { id: true, reference: true, status: true } } },
    });
    if (!w) throw new DomainError("Work item not found", 404);
    return jsonOk({ workItem: w });
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "task.manage");

    const existing = await db.workItem.findUnique({ where: { id: params.id } });
    if (!existing) throw new DomainError("Work item not found", 404);

    const body = await readJson<{
      title?: string; status?: string; priority?: string;
      assignedTo?: string; description?: string | null;
      dueDate?: string | null;
    }>(r);

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.status !== undefined) data.status = body.status as any;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.assignedTo !== undefined) data.assigneeId = body.assignedTo;
    if (body.description !== undefined) data.description = body.description;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.status === "DONE" && !existing.completedAt) data.completedAt = new Date();

    const w = await db.workItem.update({
      where: { id: params.id }, data,
      include: { case: { select: { id: true, reference: true } } },
    });

    return jsonOk({ workItem: w });
  })(req);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "task.manage");

    const w = await db.workItem.findUnique({ where: { id: params.id } });
    if (!w) throw new DomainError("Work item not found", 404);

    await db.workItem.delete({ where: { id: params.id } });

    return jsonOk({ ok: true });
  })(req);
}