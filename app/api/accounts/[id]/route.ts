import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const account = await db.account.findUnique({
      where: { id },
      include: { contacts: true, memberOf: true, children: true },
    });
    if (!account || account.orgId !== ctx.orgId) throw new DomainError("Account not found", 404);
    return jsonOk({ account });
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(r);

    const existing = await db.account.findUnique({ where: { id } });
    if (!existing || existing.orgId !== ctx.orgId) throw new DomainError("Account not found", 404);

    const account = await db.account.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name).trim().slice(0, 200) } : undefined),
        ...(body.website !== undefined ? { website: body.website ? String(body.website).trim().slice(0, 200) : null } : undefined),
        ...(body.phone !== undefined ? { phone: body.phone ? String(body.phone).trim().slice(0, 40) : null } : undefined),
        ...(body.fax !== undefined ? { fax: body.fax ? String(body.fax).trim().slice(0, 40) : null } : undefined),
        ...(body.tickerSymbol !== undefined ? { tickerSymbol: body.tickerSymbol ? String(body.tickerSymbol).trim().slice(0, 40) : null } : undefined),
        ...(body.otherPhone !== undefined ? { otherPhone: body.otherPhone ? String(body.otherPhone).trim().slice(0, 40) : null } : undefined),
        ...(body.email !== undefined ? { email: body.email ? String(body.email).trim().toLowerCase().slice(0, 160) : null } : undefined),
        ...(body.otherEmail !== undefined ? { otherEmail: body.otherEmail ? String(body.otherEmail).trim().toLowerCase().slice(0, 160) : null } : undefined),
        ...(body.ownership !== undefined ? { ownership: body.ownership ? String(body.ownership).trim().slice(0, 80) : null } : undefined),
        ...(body.industry !== undefined ? { industry: body.industry ? String(body.industry).trim().slice(0, 80) : null } : undefined),
        ...(body.rating !== undefined ? { rating: body.rating ? String(body.rating).trim().slice(0, 40) : null } : undefined),
        ...(body.type !== undefined ? { type: body.type ? String(body.type).trim().slice(0, 40) : null } : undefined),
        ...(body.sicCode !== undefined ? { sicCode: body.sicCode ? String(body.sicCode).trim().slice(0, 40) : null } : undefined),
        ...(body.emailOptOut !== undefined ? { emailOptOut: body.emailOptOut === true } : undefined),
        ...(body.annualRevenue !== undefined ? { annualRevenue: body.annualRevenue ? Number(body.annualRevenue) : null } : undefined),
        ...(body.currency !== undefined ? { currency: body.currency ? String(body.currency).trim().slice(0, 10) : null } : undefined),
        ...(body.newsletterCancelled !== undefined ? { newsletterCancelled: body.newsletterCancelled === true } : undefined),
        ...(body.language !== undefined ? { language: body.language ? String(body.language).trim().slice(0, 10) : null } : undefined),
        ...(body.basicDiscount !== undefined ? { basicDiscount: body.basicDiscount ? Number(body.basicDiscount) : null } : undefined),
        ...(body.taxSettings !== undefined ? { taxSettings: body.taxSettings ? String(body.taxSettings).trim().slice(0, 40) : null } : undefined),
        ...(body.debtorNumber !== undefined ? { debtorNumber: body.debtorNumber ? String(body.debtorNumber).trim().slice(0, 40) : null } : undefined),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId ? String(body.ownerId) : null } : undefined),
        ...(body.memberOfId !== undefined ? { memberOfId: body.memberOfId ? String(body.memberOfId) : null } : undefined),
        ...(body.partnerId !== undefined ? { partnerId: body.partnerId ? String(body.partnerId) : null } : undefined),
        ...(body.contactPersonId !== undefined ? { contactPersonId: body.contactPersonId ? String(body.contactPersonId) : null } : undefined),
        ...(body.employee !== undefined ? { employee: body.employee ? Number(body.employee) : null } : undefined),
        ...(body.salesforceAccountId !== undefined ? { salesforceAccountId: body.salesforceAccountId ? String(body.salesforceAccountId).trim().slice(0, 80) : null } : undefined),
        ...(body.billingAddress !== undefined ? { billingAddress: body.billingAddress ? String(body.billingAddress).trim().slice(0, 400) : null } : undefined),
        ...(body.shippingAddress !== undefined ? { shippingAddress: body.shippingAddress ? String(body.shippingAddress).trim().slice(0, 400) : null } : undefined),
        ...(body.billingPoBox !== undefined ? { billingPoBox: body.billingPoBox ? String(body.billingPoBox).trim().slice(0, 40) : null } : undefined),
        ...(body.shippingPoBox !== undefined ? { shippingPoBox: body.shippingPoBox ? String(body.shippingPoBox).trim().slice(0, 40) : null } : undefined),
        ...(body.billingCity !== undefined ? { billingCity: body.billingCity ? String(body.billingCity).trim().slice(0, 80) : null } : undefined),
        ...(body.shippingCity !== undefined ? { shippingCity: body.shippingCity ? String(body.shippingCity).trim().slice(0, 80) : null } : undefined),
        ...(body.billingState !== undefined ? { billingState: body.billingState ? String(body.billingState).trim().slice(0, 80) : null } : undefined),
        ...(body.shippingState !== undefined ? { shippingState: body.shippingState ? String(body.shippingState).trim().slice(0, 80) : null } : undefined),
        ...(body.billingPostalCode !== undefined ? { billingPostalCode: body.billingPostalCode ? String(body.billingPostalCode).trim().slice(0, 20) : null } : undefined),
        ...(body.shippingPostalCode !== undefined ? { shippingPostalCode: body.shippingPostalCode ? String(body.shippingPostalCode).trim().slice(0, 20) : null } : undefined),
        ...(body.billingCountry !== undefined ? { billingCountry: body.billingCountry ? String(body.billingCountry).trim().slice(0, 80) : null } : undefined),
        ...(body.shippingCountry !== undefined ? { shippingCountry: body.shippingCountry ? String(body.shippingCountry).trim().slice(0, 80) : null } : undefined),
        ...(body.billingCountryCode !== undefined ? { billingCountryCode: body.billingCountryCode ? String(body.billingCountryCode).trim().slice(0, 10) : null } : undefined),
        ...(body.shippingCountryCode !== undefined ? { shippingCountryCode: body.shippingCountryCode ? String(body.shippingCountryCode).trim().slice(0, 10) : null } : undefined),
        ...(body.bankName !== undefined ? { bankName: body.bankName ? String(body.bankName).trim().slice(0, 120) : null } : undefined),
        ...(body.bankCode !== undefined ? { bankCode: body.bankCode ? String(body.bankCode).trim().slice(0, 40) : null } : undefined),
        ...(body.bankAccountNumber !== undefined ? { bankAccountNumber: body.bankAccountNumber ? String(body.bankAccountNumber).trim().slice(0, 40) : null } : undefined),
        ...(body.iban !== undefined ? { iban: body.iban ? String(body.iban).trim().slice(0, 40) : null } : undefined),
        ...(body.bic !== undefined ? { bic: body.bic ? String(body.bic).trim().slice(0, 20) : null } : undefined),
        ...(body.description !== undefined ? { description: body.description ? String(body.description).trim().slice(0, 4000) : null } : undefined),
        ...(body.accountImage !== undefined ? { accountImage: body.accountImage ? String(body.accountImage).trim().slice(0, 400) : null } : undefined),
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.account.updated",
      target: account.id,
      after: { name: account.name },
      correlationId,
    });

    return jsonOk({ account });
  })(req);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;

    const existing = await db.account.findUnique({ where: { id } });
    if (!existing || existing.orgId !== ctx.orgId) throw new DomainError("Account not found", 404);

    await db.account.delete({ where: { id } });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.account.deleted",
      target: id,
      correlationId,
    });

    return jsonOk({ ok: true });
  })(req);
}
