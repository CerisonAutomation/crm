import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import { nextCaseRef, transitionCase } from "@/lib/services/case-service";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { DomainError } from "@/lib/domain/states";

export type OnboardingProfileInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
  address: string;
  city: string;
  country: string;
};

export type OnboardingContext = {
  userId: string;
  orgId: string;
  name: string;
  correlationId: string;
};

export type OnboardingResult = {
  caseId: string;
  reference: string;
  status: "CREATED" | "CORRECTED";
};

/**
 * OnboardingService — encapsulates the client onboarding flow.
 *
 * Handles:
 * - Initial profile submission (creates case)
 * - Profile correction (updates existing case in ONBOARDING status)
 */
export class OnboardingService {
  /**
   * Submit or correct onboarding profile.
   * Creates a new case if none exists, or corrects an existing ONBOARDING case.
   */
  static async submitProfile(
    input: OnboardingProfileInput,
    ctx: OnboardingContext
  ): Promise<OnboardingResult> {
    // Validate required fields
    for (const k of ["firstName", "lastName", "dateOfBirth", "nationality", "address", "city", "country"] as const) {
      if (!input[k]?.trim()) throw new DomainError(`Field ${k} is required`, 400);
    }

    const existingCase = await db.case.findFirst({ where: { clientId: ctx.userId } });

    if (existingCase) {
      // CORRECTION MODE — the RM's request-changes action leaves the case in
      // ONBOARDING with dataApproval PENDING (only that action produces this
      // combination; initial cases carry dataApproval null). The client
      // re-submits the same fields as the create path and the case legally
      // advances ONBOARDING → DATA_SUBMITTED for a fresh review.
      if (existingCase.status === "ONBOARDING" && existingCase.dataApproval === "PENDING") {
        return this.correctProfile(input, ctx, existingCase.id, existingCase.reference);
      }
      throw new DomainError("Case already exists and cannot be modified", 409);
    }

    return this.createProfile(input, ctx);
  }

  private static async createProfile(
    input: OnboardingProfileInput,
    ctx: OnboardingContext
  ): Promise<OnboardingResult> {
    const reference = await nextCaseRef();
    const user = await db.user.update({
      where: { id: ctx.userId },
      data: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        dateOfBirth: input.dateOfBirth,
        nationality: input.nationality,
        phone: input.phone,
        address: input.address,
        city: input.city,
        country: input.country,
        profileState: "SUBMITTED",
      },
      select: { id: true },
    });

    const caseRow = await db.case.create({
      data: {
        reference,
        clientId: ctx.userId,
        orgId: ctx.orgId,
        status: "ONBOARDING",
        dataApproval: "PENDING",
      },
      select: { id: true, reference: true },
    });

    await transitionCase({
      caseId: caseRow.id,
      to: "DATA_SUBMITTED",
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      command: "profile.submitted",
      reason: "Client submitted profile data",
      correlationId: ctx.correlationId,
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      action: "profile.submitted",
      target: caseRow.reference,
      after: {
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        nationality: input.nationality,
        phone: input.phone,
        address: input.address,
        city: input.city,
        country: input.country,
      },
      correlationId: ctx.correlationId,
    });

    await emitCaseEvent("case.status.changed", {
      caseId: caseRow.id,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      meta: { from: "ONBOARDING", to: "DATA_SUBMITTED", command: "profile.submitted", reason: "Client submitted profile data" },
    });

    return { caseId: caseRow.id, reference: caseRow.reference, status: "CREATED" };
  }

  private static async correctProfile(
    input: OnboardingProfileInput,
    ctx: OnboardingContext,
    caseId: string,
    reference: string
  ): Promise<OnboardingResult> {
    const before = await db.user.findUnique({
      where: { id: ctx.userId },
      select: {
        firstName: true, lastName: true, dateOfBirth: true, nationality: true,
        phone: true, address: true, city: true, country: true, profileState: true,
      },
    });

    const updated = await db.user.update({
      where: { id: ctx.userId },
      data: {
        firstName: input.firstName.trim(), lastName: input.lastName.trim(),
        dateOfBirth: input.dateOfBirth, nationality: input.nationality,
        phone: input.phone, address: input.address, city: input.city, country: input.country,
        profileState: "SUBMITTED",
      },
      select: {
        id: true, profileState: true, firstName: true, lastName: true, dateOfBirth: true,
        nationality: true, phone: true, address: true, city: true, country: true,
      },
    });

    await transitionCase({
      caseId,
      to: "DATA_SUBMITTED",
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      command: "profile.corrected",
      reason: "Client corrected profile data",
      correlationId: ctx.correlationId,
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      action: "profile.corrected",
      target: reference,
      before,
      after: {
        firstName: updated.firstName, lastName: updated.lastName, dateOfBirth: updated.dateOfBirth,
        nationality: updated.nationality, phone: updated.phone, address: updated.address,
        city: updated.city, country: updated.country, profileState: updated.profileState,
      },
      correlationId: ctx.correlationId,
    });

    await emitCaseEvent("case.status.changed", {
      caseId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      meta: { from: "ONBOARDING", to: "DATA_SUBMITTED", command: "profile.corrected", reason: "Client corrected profile data" },
    });

    return { caseId, reference, status: "CORRECTED" };
  }
}
