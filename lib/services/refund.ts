import { db } from "@/lib/db";

export interface CreateRefundInput {
  orgId: string;
  caseId?: string;
  paymentId?: string;
  amountCents: number;
  currency?: string;
  reason: string;
}

export interface UpdateRefundInput {
  status?: "PENDING" | "APPROVED" | "REJECTED" | "PROCESSED";
  processedBy?: string;
}

export async function createRefund(input: CreateRefundInput) {
  return db.refund.create({
    data: {
      orgId: input.orgId,
      caseId: input.caseId,
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      currency: input.currency ?? "CHF",
      reason: input.reason,
    },
  });
}

export async function getRefund(id: string) {
  return db.refund.findUnique({
    where: { id },
  });
}

export async function getRefunds(orgId: string, filters?: {
  caseId?: string;
  status?: string;
}) {
  return db.refund.findMany({
    where: {
      orgId,
      ...(filters?.caseId ? { caseId: filters.caseId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateRefund(id: string, input: UpdateRefundInput) {
  return db.refund.update({
    where: { id },
    data: {
      ...input,
      ...(input.status === "PROCESSED" ? { processedAt: new Date() } : {}),
    },
  });
}

export async function deleteRefund(id: string) {
  return db.refund.delete({
    where: { id },
  });
}
