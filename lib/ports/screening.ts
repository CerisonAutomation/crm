// H2 port — screening vendor contract (Prisma-free, import anywhere).
// KYC/AML/EDD checks run through this seam. H3 offline default returns
// PENDING_REVIEW so no applicant is auto-cleared or auto-rejected without a
// vendor verdict plus human review.

export type ScreeningVerdict = "CLEAR" | "FLAG" | "PENDING_REVIEW";

export type ScreeningRequest = {
  caseId: string;
  subjectRef: string;
  idempotencyKey: string;
};

export type ScreeningResult = {
  verdict: ScreeningVerdict;
  vendorRef: string;
  checkedAt: Date;
};

export interface ScreeningVendor {
  readonly name: string;
  screen(request: ScreeningRequest): Promise<ScreeningResult>;
}

export const offlineScreeningVendor: ScreeningVendor = {
  name: "offline",
  screen: async (request) => ({
    verdict: "PENDING_REVIEW",
    vendorRef: `offline:${request.caseId}`,
    checkedAt: new Date(),
  }),
};
