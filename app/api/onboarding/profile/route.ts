import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { OnboardingService } from "@/lib/services/onboarding";

type Body = {
  firstName: string; lastName: string; dateOfBirth: string; nationality: string;
  phone: string; address: string; city: string; country: string;
};

// POST /api/onboarding/profile — client onboarding step 1 (creates case)
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.own");
    if (ctx.role !== "CLIENT") throw new DomainError("Only clients complete onboarding", 403);
    const body = await readJson<Body>(r);

    const result = await OnboardingService.submitProfile(body, {
      userId: ctx.userId,
      orgId: ctx.orgId,
      name: ctx.name,
      correlationId,
    });

    return jsonOk({ case: { id: result.caseId, reference: result.reference }, status: result.status }, result.status === "CREATED" ? 201 : 200);
  })(req);
}
