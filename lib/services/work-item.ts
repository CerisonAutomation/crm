import { db } from "@/lib/db";

export interface CreateWorkItemInput {
  orgId: string;
  caseId?: string;
  title: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeId?: string;
  dueDate?: Date;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  status?: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeId?: string;
  dueDate?: Date;
}

export async function createWorkItem(input: CreateWorkItemInput) {
  return db.workItem.create({
    data: {
      orgId: input.orgId,
      caseId: input.caseId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "MEDIUM",
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
    },
  });
}

export async function getWorkItem(id: string) {
  return db.workItem.findUnique({
    where: { id },
  });
}

export async function getWorkItems(orgId: string, filters?: {
  caseId?: string;
  status?: string;
  assigneeId?: string;
  priority?: string;
}) {
  return db.workItem.findMany({
    where: {
      orgId,
      ...(filters?.caseId ? { caseId: filters.caseId } : undefined),
      ...(filters?.status ? { status: filters.status } : undefined),
      ...(filters?.assigneeId ? { assigneeId: filters.assigneeId } : undefined),
      ...(filters?.priority ? { priority: filters.priority } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateWorkItem(id: string, input: UpdateWorkItemInput) {
  return db.workItem.update({
    where: { id },
    data: {
      ...input,
      ...(input.status === "DONE" ? { completedAt: new Date() } : undefined),
    },
  });
}

export async function deleteWorkItem(id: string) {
  return db.workItem.delete({
    where: { id },
  });
}
