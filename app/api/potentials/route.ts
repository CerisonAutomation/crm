import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);
    const q = url.searchParams.get("q")?.trim();
    const orgId = ctx.orgId;

    const potentials = await db.potential.findMany({
      where: {
        orgId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { potentialNo: { contains: q, mode: "insensitive" } },
                { opportunityType: { contains: q, mode: "insensitive" } },
                { leadsource: { contains: q, mode: "insensitive" } },
                { stage: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 201,
      include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
    });
    return jsonOk({ potentials: potentials.slice(0, 200), truncated: potentials.length > 200 });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const body = await readJson<Record<string, unknown>>(r);

    const name = String(body.name ?? "").trim();
    if (!name) throw new DomainError("Potential name is required", 400);

    const count = await db.potential.count({ where: { orgId: ctx.orgId } });
    const potentialNo = `POT${700 + count + 1}`;

    const potential = await db.potential.create({
      data: {
        orgId: ctx.orgId,
        potentialNo,
        name: name.slice(0, 200),
        accountId: body.accountId ? String(body.accountId) : null,
        contactId: body.contactId ? String(body.contactId) : null,
        leadId: body.leadId ? String(body.leadId) : null,
        ownerId: body.ownerId ? String(body.ownerId) : ctx.userId,
        createdBy: ctx.userId,
        opportunityType: body.opportunityType ? String(body.opportunityType).trim().slice(0, 80) : null,
        leadsource: body.leadsource ? String(body.leadsource).trim().slice(0, 80) : null,
        stage: body.stage ? String(body.stage).trim().slice(0, 40) : "Prospecting",
        probability: body.probability ? Number(body.probability) : 0,
        amount: body.amount ? Number(body.amount) : null,
        currency: body.currency ? String(body.currency).trim().slice(0, 10) : "EUR",
        closingDate: body.closingDate ? new Date(String(body.closingDate)) : null,
        nextstep: body.nextstep ? String(body.nextstep).trim().slice(0, 4000) : null,
        description: body.description ? String(body.description).trim().slice(0, 4000) : null,
        isClosed: body.isClosed === true,
        isWon: body.isWon === true,
        interestIn: body.interestIn ? String(body.interestIn).trim().slice(0, 200) : null,
        anticipatedBusinessType: body.anticipatedBusinessType ? String(body.anticipatedBusinessType).trim().slice(0, 80) : null,
        citizenship: body.citizenship ? String(body.citizenship).trim().slice(0, 80) : null,
        referringPerson: body.referringPerson ? String(body.referringPerson).trim().slice(0, 120) : null,
        inquiry: body.inquiry ? String(body.inquiry).trim().slice(0, 200) : null,
        inquiryDate: body.inquiryDate ? new Date(String(body.inquiryDate)) : null,
        plannedInvestment: body.plannedInvestment ? Number(body.plannedInvestment) : null,
        inContactWithClient: body.inContactWithClient ? String(body.inContactWithClient).trim().slice(0, 120) : null,
        nextCall: body.nextCall ? new Date(String(body.nextCall)) : null,
        taxType: body.taxType ? String(body.taxType).trim().slice(0, 40) : null,
        language: body.language ? String(body.language).trim().slice(0, 10) : null,
        basicDiscount: body.basicDiscount ? Number(body.basicDiscount) : null,
        servicesInterestedIn: body.servicesInterestedIn ? String(body.servicesInterestedIn).trim().slice(0, 400) : null,
        workflowEmailsActive: body.workflowEmailsActive ? String(body.workflowEmailsActive).trim().slice(0, 40) : null,
        registeredForEvent: body.registeredForEvent ? String(body.registeredForEvent).trim().slice(0, 120) : null,
        metAtEvent: body.metAtEvent ? String(body.metAtEvent).trim().slice(0, 120) : null,
        salesCommission: body.salesCommission ? Number(body.salesCommission) : null,
        sharedSalesCommission: body.sharedSalesCommission ? Number(body.sharedSalesCommission) : null,
        commissionDueOn: body.commissionDueOn ? new Date(String(body.commissionDueOn)) : null,
        commissionsPaidOn: body.commissionsPaidOn ? new Date(String(body.commissionsPaidOn)) : null,
        commissionPaidTo: body.commissionPaidTo ? String(body.commissionPaidTo).trim().slice(0, 120) : null,
        commissionNotes: body.commissionNotes ? String(body.commissionNotes).trim().slice(0, 4000) : null,
        commissionsSharedWith: body.commissionsSharedWith ? String(body.commissionsSharedWith).trim().slice(0, 200) : null,
        clientAgreementSentOn: body.clientAgreementSentOn ? new Date(String(body.clientAgreementSentOn)) : null,
        clientAgreementSignedOn: body.clientAgreementSignedOn ? new Date(String(body.clientAgreementSignedOn)) : null,
        applicationStatus: body.applicationStatus ? String(body.applicationStatus).trim().slice(0, 80) : null,
        fullPaymentReceivedOn: body.fullPaymentReceivedOn ? new Date(String(body.fullPaymentReceivedOn)) : null,
        expectedCaseConclusion: body.expectedCaseConclusion ? new Date(String(body.expectedCaseConclusion)) : null,
        applicationSubmittedOn: body.applicationSubmittedOn ? new Date(String(body.applicationSubmittedOn)) : null,
        processingGovernmentOfficer: body.processingGovernmentOfficer ? String(body.processingGovernmentOfficer).trim().slice(0, 120) : null,
        governmentCaseNumber: body.governmentCaseNumber ? String(body.governmentCaseNumber).trim().slice(0, 80) : null,
        familyMembersCount: body.familyMembersCount ? Number(body.familyMembersCount) : null,
        commissionsDueToIntroducer: body.commissionsDueToIntroducer ? Number(body.commissionsDueToIntroducer) : null,
        commissionsDueBy: body.commissionsDueBy ? new Date(String(body.commissionsDueBy)) : null,
        commissionPaidOn: body.commissionPaidOn ? new Date(String(body.commissionPaidOn)) : null,
        processingPartnerLawyer: body.processingPartnerLawyer ? String(body.processingPartnerLawyer).trim().slice(0, 120) : null,
        biometricsAppointment: body.biometricsAppointment ? new Date(String(body.biometricsAppointment)) : null,
        approvalInPrincipleReceived: body.approvalInPrincipleReceived ? new Date(String(body.approvalInPrincipleReceived)) : null,
        finalApproval: body.finalApproval ? new Date(String(body.finalApproval)) : null,
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.potential.created",
      target: potential.id,
      after: { name: potential.name, potentialNo: potential.potentialNo },
      correlationId,
    });

    return jsonOk({ potential }, 201);
  })(req);
}
