import { db } from "@/lib/db";

export interface CreateProviderReceiptInput {
  orgId: string;
  provider: string;
  operation: string;
  operationKey: string;
  requestHash?: string;
  responseHash?: string;
  responseStatus?: number;
  error?: string;
}

export interface UpdateProviderReceiptInput {
  status?: "PENDING" | "SUCCEEDED" | "FAILED" | "TIMEOUT";
  responseHash?: string;
  responseStatus?: number;
  error?: string;
  retryCount?: number;
}

export async function createProviderReceipt(input: CreateProviderReceiptInput) {
  return db.providerReceipt.create({
    data: {
      orgId: input.orgId,
      provider: input.provider,
      operation: input.operation,
      operationKey: input.operationKey,
      requestHash: input.requestHash,
      responseHash: input.responseHash,
      responseStatus: input.responseStatus,
      error: input.error,
    },
  });
}

export async function getProviderReceipt(id: string) {
  return db.providerReceipt.findUnique({
    where: { id },
  });
}

export async function getProviderReceiptByKey(operationKey: string) {
  return db.providerReceipt.findUnique({
    where: { operationKey },
  });
}

export async function getProviderReceipts(orgId: string, filters?: {
  provider?: string;
  status?: string;
}) {
  return db.providerReceipt.findMany({
    where: {
      orgId,
      ...(filters?.provider ? { provider: filters.provider } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateProviderReceipt(id: string, input: UpdateProviderReceiptInput) {
  return db.providerReceipt.update({
    where: { id },
    data: {
      ...input,
      ...(input.status === "SUCCEEDED" || input.status === "FAILED" || input.status === "TIMEOUT"
        ? { completedAt: new Date() }
        : {}),
    },
  });
}

export async function deleteProviderReceipt(id: string) {
  return db.providerReceipt.delete({
    where: { id },
  });
}
