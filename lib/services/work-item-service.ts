/**
 * Citizen Lane work item service — WorkItem CRUD for the RM/compliance queue.
 */
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";

export type CreateWorkItemInput = {
  title: string;
  type: string;
  priority?: string;
  requiredRole?: string;
  assignedTo?: string;
  caseId?: string;
  workflowRunId?: string;
  nodeRunId?: string;
  body?: string | null;
  dueDate?: Date | null;
};

export type UpdateWorkItemInput = {
  title?: string;
  status?: string;
  priority?: string;
  type?: string;
  requiredRole?: string;
  assignedTo?: string;
  body?: string | null;
  dueDate?: Date | null;
  decision?: string | null;
  decisionReason?: string | null;
  decisionBy?: string | null;
};

export async function listWorkItems(opts?: {
  status?: string; priority?: string; type?: string;
  caseId?: string; assignedTo?: string; requiredRole?: string;
  limit?: number; cursor?: string;
}) {
  const where: Record<string, unknown> = {};
  if (opts?.status) where.status = opts.status;
  if (opts?.priority) where.priority = opts.priority;
  if (opts?.type) where.type = opts.type;
  if (opts?.caseId) where.caseIdRef = opts.caseId;
  if (opts?.assignedTo) where.assignedTo = opts.assignedTo;
  if (opts?.requiredRole) where.requiredRole = opts.requiredRole;

  return db.workItem.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: opts?.limit ?? 50,
    cursor: opts?.cursor ? { id: opts.cursor } : undefined,
    include: { case: { select: { id: true, reference: true, stage: true } } },
  });
}

export async function getWorkItem(id: string) {
  const w = await db.workItem.findUnique({
    where: { id },
    include: { case: { select: { id: true, reference: true, stage: true } } },
  });
  if (!w) throw new DomainError("Work item not found", 404);
  return w;
}

export async function createWorkItem(input: CreateWorkItemInput) {
  return db.workItem.create({
    data: {
      title: input.title, type: input.type,
      priority: (input.priority ?? "NORMAL") as any,
      requiredRole: input.requiredRole ?? null,
      assignedTo: input.assignedTo ?? null,
      caseIdRef: input.caseId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      nodeRunId: input.nodeRunId ?? null,
      body: input.body ?? null,
      dueDate: input.dueDate ?? null,
    },
    include: { case: { select: { id: true, reference: true } } },
  });
}

export async function updateWorkItem(id: string, input: UpdateWorkItemInput) {
  const existing = await db.workItem.findUnique({ where: { id } });
  if (!existing) throw new DomainError("Work item not found", 404);

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.status !== undefined) data.status = input.status as any;
  if (input.priority !== undefined) data.priority = input.priority as any;
  if (input.type !== undefined) data.type = input.type;
  if (input.requiredRole !== undefined) data.requiredRole = input.requiredRole;
  if (input.assignedTo !== undefined) data.assignedTo = input.assignedTo;
  if (input.body !== undefined) data.body = input.body;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate;
  if (input.decision !== undefined) data.decision = input.decision;
  if (input.decisionReason !== undefined) data.decisionReason = input.decisionReason;
  if (input.decisionBy !== undefined) data.decisionBy = input.decisionBy;
  if (input.status === "DONE" && !existing.completedAt) data.completedAt = new Date();

  return db.workItem.update({ where: { id }, data,
    include: { case: { select: { id: true, reference: true } } },
  });
}

export async function deleteWorkItem(id: string) {
  const w = await db.workItem.findUnique({ where: { id } });
  if (!w) throw new DomainError("Work item not found", 404);
  await db.workItem.delete({ where: { id } });
}