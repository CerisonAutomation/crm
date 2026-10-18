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

    const salesOrders = await db.salesOrder.findMany({
      where: {
        orgId,
        ...(q
          ? {
              OR: [
                { subject: { contains: q, mode: "insensitive" } },
                { salesOrderNo: { contains: q, mode: "insensitive" } },
                { status: { contains: q, mode: "insensitive" } },
                { carrier: { contains: q, mode: "insensitive" } },
              ],
            } : undefined),
      },
      orderBy: { createdAt: "desc" },
      take: 201,
      include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
    });
    return jsonOk({ salesOrders: salesOrders.slice(0, 200), truncated: salesOrders.length > 200 });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const body = await readJson<Record<string, unknown>>(r);

    const subject = String(body.subject ?? "").trim();
    if (!subject) throw new DomainError("Sales order subject is required", 400);

    const count = await db.salesOrder.count({ where: { orgId: ctx.orgId } });
    const salesOrderNo = `SO${700 + count + 1}`;

    const salesOrder = await db.salesOrder.create({
      data: {
        orgId: ctx.orgId,
        salesOrderNo,
        subject: subject.slice(0, 200),
        accountId: body.accountId ? String(body.accountId) : null,
        contactId: body.contactId ? String(body.contactId) : null,
        ownerId: body.ownerId ? String(body.ownerId) : ctx.userId,
        createdBy: ctx.userId,
        quoteId: body.quoteId ? String(body.quoteId) : null,
        status: body.status ? String(body.status).trim().slice(0, 40) : "Draft",
        dueDate: body.dueDate ? new Date(String(body.dueDate)) : null,
        carrier: body.carrier ? String(body.carrier).trim().slice(0, 80) : null,
        salesCommission: body.salesCommission ? Number(body.salesCommission) : null,
        exciseDuty: body.exciseDuty ? Number(body.exciseDuty) : null,
        total: body.total ? Number(body.total) : null,
        currency: body.currency ? String(body.currency).trim().slice(0, 10) : "EUR",
        billingAddress: body.billingAddress ? String(body.billingAddress).trim().slice(0, 400) : null,
        billingCity: body.billingCity ? String(body.billingCity).trim().slice(0, 80) : null,
        billingState: body.billingState ? String(body.billingState).trim().slice(0, 80) : null,
        billingPostalCode: body.billingPostalCode ? String(body.billingPostalCode).trim().slice(0, 20) : null,
        billingCountry: body.billingCountry ? String(body.billingCountry).trim().slice(0, 80) : null,
        shippingAddress: body.shippingAddress ? String(body.shippingAddress).trim().slice(0, 400) : null,
        shippingCity: body.shippingCity ? String(body.shippingCity).trim().slice(0, 80) : null,
        shippingState: body.shippingState ? String(body.shippingState).trim().slice(0, 80) : null,
        shippingPostalCode: body.shippingPostalCode ? String(body.shippingPostalCode).trim().slice(0, 20) : null,
        shippingCountry: body.shippingCountry ? String(body.shippingCountry).trim().slice(0, 80) : null,
        termsAndConditions: body.termsAndConditions ? String(body.termsAndConditions).trim().slice(0, 4000) : null,
        description: body.description ? String(body.description).trim().slice(0, 4000) : null,
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.salesorder.created",
      target: salesOrder.id,
      after: { subject: salesOrder.subject, salesOrderNo: salesOrder.salesOrderNo },
      correlationId,
    });

    return jsonOk({ salesOrder }, 201);
  })(req);
}
