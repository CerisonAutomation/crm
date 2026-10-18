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
      ...(filters?.caseId ? { caseId: filters.caseId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.partnerType ? { partnerType: filters.partnerType } : {}),
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
      ...(documentRefs ? { documentRefs: JSON.stringify(documentRefs) } : {}),
      ...(input.status === "SENT" ? { sentAt: new Date() } : {}),
      ...(input.status === "ACKNOWLEDGED" ? { acknowledgedAt: new Date() } : {}),
    },
  });
}

export async function deleteHandoff(id: string) {
  return db.handoff.delete({
    where: { id },
  });
}
