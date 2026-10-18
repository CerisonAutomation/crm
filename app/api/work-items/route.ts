import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

export async function GET(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const { searchParams } = new URL(r.url);
    const status = searchParams.get("status") || undefined;
    const priority = searchParams.get("priority") || undefined;
    const type = searchParams.get("type") || undefined;
    const caseId = searchParams.get("caseId") || undefined;
    const assignedTo = searchParams.get("assignedTo") || undefined;
    const requiredRole = searchParams.get("requiredRole") || undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
    const cursor = searchParams.get("cursor") || undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;
    if (caseId) where.caseIdRef = caseId;
    if (assignedTo) where.assignedTo = assignedTo;
    if (requiredRole) where.requiredRole = requiredRole;

    const items = await db.workItem.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      take: limit,
      cursor: cursor ? { id: cursor } : undefined,
      include: { case: { select: { id: true, reference: true, stage: true } } },
    });

    return jsonOk({
      workItems: items,
      nextCursor: items.length === limit ? items[items.length - 1]?.id : undefined,
    }, correlationId);
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "task.create");

    const body = await readJson<{
      title: string; type: string; priority?: string;
      requiredRole?: string; assignedTo?: string; caseId?: string;
      body?: string | null; dueDate?: string | null;
    }>(r);
    if (!body.title?.trim()) throw new DomainError("Title required", 400);

    const w = await db.workItem.create({
      data: {
        title: body.title.trim(), type: body.type,
        priority: (body.priority ?? "NORMAL") as any,
        requiredRole: body.requiredRole ?? null,
        assignedTo: body.assignedTo ?? null,
        caseIdRef: body.caseId ?? null,
        body: body.body ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
      },
      include: { case: { select: { id: true, reference: true } } },
    });

    return jsonOk({ workItem: w }, 201, correlationId);
  })(req);
}