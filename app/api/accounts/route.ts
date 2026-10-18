import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

// GET /api/accounts — list accounts for the org.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);
    const q = url.searchParams.get("q")?.trim();
    const orgId = ctx.orgId;

    const accounts = await db.account.findMany({
      where: {
        orgId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { accountNo: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
                { website: { contains: q, mode: "insensitive" } },
                { billingCity: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 201,
      include: { contacts: { select: { id: true, name: true } } },
    });
    return jsonOk({ accounts: accounts.slice(0, 200), truncated: accounts.length > 200 });
  })(req);
}

// POST /api/accounts — create an account.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const body = await readJson<Record<string, unknown>>(r);

    const name = String(body.name ?? "").trim();
    if (!name) throw new DomainError("Account name is required", 400);

    // Auto-generate account number
    const count = await db.account.count({ where: { orgId: ctx.orgId } });
    const accountNo = `ACC${700 + count + 1}`;

    const account = await db.account.create({
      data: {
        orgId: ctx.orgId,
        accountNo,
        name: name.slice(0, 200),
        website: body.website ? String(body.website).trim().slice(0, 200) : null,
        phone: body.phone ? String(body.phone).trim().slice(0, 40) : null,
        fax: body.fax ? String(body.fax).trim().slice(0, 40) : null,
        tickerSymbol: body.tickerSymbol ? String(body.tickerSymbol).trim().slice(0, 40) : null,
        otherPhone: body.otherPhone ? String(body.otherPhone).trim().slice(0, 40) : null,
        email: body.email ? String(body.email).trim().toLowerCase().slice(0, 160) : null,
        otherEmail: body.otherEmail ? String(body.otherEmail).trim().toLowerCase().slice(0, 160) : null,
        ownership: body.ownership ? String(body.ownership).trim().slice(0, 80) : null,
        industry: body.industry ? String(body.industry).trim().slice(0, 80) : null,
        rating: body.rating ? String(body.rating).trim().slice(0, 40) : null,
        type: body.type ? String(body.type).trim().slice(0, 40) : null,
        sicCode: body.sicCode ? String(body.sicCode).trim().slice(0, 40) : null,
        emailOptOut: body.emailOptOut === true,
        annualRevenue: body.annualRevenue ? Number(body.annualRevenue) : null,
        currency: body.currency ? String(body.currency).trim().slice(0, 10) : "EUR",
        newsletterCancelled: body.newsletterCancelled === true,
        language: body.language ? String(body.language).trim().slice(0, 10) : null,
        basicDiscount: body.basicDiscount ? Number(body.basicDiscount) : null,
        taxSettings: body.taxSettings ? String(body.taxSettings).trim().slice(0, 40) : null,
        debtorNumber: body.debtorNumber ? String(body.debtorNumber).trim().slice(0, 40) : null,
        ownerId: body.ownerId ? String(body.ownerId) : ctx.userId,
        createdBy: ctx.userId,
        memberOfId: body.memberOfId ? String(body.memberOfId) : null,
        partnerId: body.partnerId ? String(body.partnerId) : null,
        contactPersonId: body.contactPersonId ? String(body.contactPersonId) : null,
        employee: body.employee ? Number(body.employee) : null,
        salesforceAccountId: body.salesforceAccountId ? String(body.salesforceAccountId).trim().slice(0, 80) : null,
        billingAddress: body.billingAddress ? String(body.billingAddress).trim().slice(0, 400) : null,
        shippingAddress: body.shippingAddress ? String(body.shippingAddress).trim().slice(0, 400) : null,
        billingPoBox: body.billingPoBox ? String(body.billingPoBox).trim().slice(0, 40) : null,
        shippingPoBox: body.shippingPoBox ? String(body.shippingPoBox).trim().slice(0, 40) : null,
        billingCity: body.billingCity ? String(body.billingCity).trim().slice(0, 80) : null,
        shippingCity: body.shippingCity ? String(body.shippingCity).trim().slice(0, 80) : null,
        billingState: body.billingState ? String(body.billingState).trim().slice(0, 80) : null,
        shippingState: body.shippingState ? String(body.shippingState).trim().slice(0, 80) : null,
        billingPostalCode: body.billingPostalCode ? String(body.billingPostalCode).trim().slice(0, 20) : null,
        shippingPostalCode: body.shippingPostalCode ? String(body.shippingPostalCode).trim().slice(0, 20) : null,
        billingCountry: body.billingCountry ? String(body.billingCountry).trim().slice(0, 80) : "Germany",
        shippingCountry: body.shippingCountry ? String(body.shippingCountry).trim().slice(0, 80) : "Germany",
        billingCountryCode: body.billingCountryCode ? String(body.billingCountryCode).trim().slice(0, 10) : null,
        shippingCountryCode: body.shippingCountryCode ? String(body.shippingCountryCode).trim().slice(0, 10) : null,
        bankName: body.bankName ? String(body.bankName).trim().slice(0, 120) : null,
        bankCode: body.bankCode ? String(body.bankCode).trim().slice(0, 40) : null,
        bankAccountNumber: body.bankAccountNumber ? String(body.bankAccountNumber).trim().slice(0, 40) : null,
        iban: body.iban ? String(body.iban).trim().slice(0, 40) : null,
        bic: body.bic ? String(body.bic).trim().slice(0, 20) : null,
        description: body.description ? String(body.description).trim().slice(0, 4000) : null,
        accountImage: body.accountImage ? String(body.accountImage).trim().slice(0, 400) : null,
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.account.created",
      target: account.id,
      after: { name: account.name, accountNo: account.accountNo },
      correlationId,
    });

    return jsonOk({ account }, 201);
  })(req);
}
