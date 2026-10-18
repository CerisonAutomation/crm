import { db } from "@/lib/db";

export interface CreateKycCheckInput {
  orgId: string;
  caseId?: string;
  checkType: "IDENTITY" | "SANCTIONS" | "PEP" | "ADVERSE_MEDIA" | "SOURCE_OF_FUNDS";
  provider?: string;
  providerRef?: string;
}

export interface UpdateKycCheckInput {
  status?: "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED" | "REVIEW";
  result?: string;
  riskScore?: number;
  reviewedBy?: string;
  notes?: string;
}

export async function createKycCheck(input: CreateKycCheckInput) {
  return db.kycCheck.create({
    data: {
      orgId: input.orgId,
      caseId: input.caseId,
      checkType: input.checkType,
      provider: input.provider,
      providerRef: input.providerRef,
    },
  });
}

export async function getKycCheck(id: string) {
  return db.kycCheck.findUnique({
    where: { id },
  });
}

export async function getKycChecks(orgId: string, filters?: {
  caseId?: string;
  checkType?: string;
  status?: string;
}) {
  return db.kycCheck.findMany({
    where: {
      orgId,
      ...(filters?.caseId ? { caseId: filters.caseId } : undefined),
      ...(filters?.checkType ? { checkType: filters.checkType } : undefined),
      ...(filters?.status ? { status: filters.status } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateKycCheck(id: string, input: UpdateKycCheckInput) {
  return db.kycCheck.update({
    where: { id },
    data: {
      ...input,
      ...(input.reviewedBy ? { reviewedAt: new Date() } : undefined),
    },
  });
}

export async function deleteKycCheck(id: string) {
  return db.kycCheck.delete({
    where: { id },
  });
}
