import { db } from "@/lib/db";

export interface CreateHumanTaskInput {
  orgId: string;
  caseId?: string;
  runId?: string;
  nodeRunId?: string;
  title: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeId?: string;
  dueDate?: Date;
}

export interface UpdateHumanTaskInput {
  title?: string;
  description?: string;
  status?: "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeId?: string;
  dueDate?: Date;
}

export async function createHumanTask(input: CreateHumanTaskInput) {
  return db.humanTask.create({
    data: {
      orgId: input.orgId,
      caseId: input.caseId,
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "MEDIUM",
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
    },
  });
}

export async function getHumanTask(id: string) {
  return db.humanTask.findUnique({
    where: { id },
    include: { assignee: true },
  });
}

export async function getHumanTasks(orgId: string, filters?: {
  caseId?: string;
  status?: string;
  assigneeId?: string;
  priority?: string;
}) {
  return db.humanTask.findMany({
    where: {
      orgId,
      ...(filters?.caseId ? { caseId: filters.caseId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters?.priority ? { priority: filters.priority } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateHumanTask(id: string, input: UpdateHumanTaskInput) {
  return db.humanTask.update({
    where: { id },
    data: {
      ...input,
      ...(input.status === "COMPLETED" ? { completedAt: new Date() } : {}),
    },
  });
}

export async function deleteHumanTask(id: string) {
  return db.humanTask.delete({
    where: { id },
  });
}
