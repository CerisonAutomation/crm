import { db } from "@/lib/db";

export interface CreateHandoffInput {
  orgId: string;
  caseId?: string;
  partnerName: string;
  partnerType: "AUTHORITY" | "PARTNER" | "VENDOR";
  documentRefs?: string[];
  notes?: string;
}

export interface UpdateHandoffInput {
  status?: "PREPARED" | "SENT" | "ACKNOWLEDGED" | "COMPLETED";
  packageHash?: string;
  documentRefs?: string[];
  notes?: string;
}

export async function createHandoff(input: CreateHandoffInput) {
  return db.handoff.create({
    data: {
      orgId: input.orgId,
      caseId: input.caseId,
      partnerName: input.partnerName,
      partnerType: input.partnerType,
      documentRefs: JSON.stringify(input.documentRefs ?? []),
      notes: input.notes,
    },
  });
}

export async function getHandoff(id: string) {
  return db.handoff.findUnique({
    where: { id },
  });
}

export async function getHandoffs(orgId: string, filters?: {
  caseId?: string;
  status?: string;
  partnerType?: string;
}) {
  return db.handoff.findMany({
    where: {
      orgId,
      ...(filters?.caseId ? { caseId: filters.caseId } : undefined),
      ...(filters?.status ? { status: filters.status } : undefined),
      ...(filters?.partnerType ? { partnerType: filters.partnerType } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateHandoff(id: string, input: UpdateHandoffInput) {
  const { documentRefs, ...rest } = input;
  return db.handoff.update({
    where: { id },
    data: {
      ...rest,
      ...(documentRefs ? { documentRefs: JSON.stringify(documentRefs) } : undefined),
      ...(input.status === "SENT" ? { sentAt: new Date() } : undefined),
      ...(input.status === "ACKNOWLEDGED" ? { acknowledgedAt: new Date() } : undefined),
    },
  });
}

export async function deleteHandoff(id: string) {
  return db.handoff.delete({
    where: { id },
  });
}
