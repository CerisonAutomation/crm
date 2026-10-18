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

    const products = await db.product.findMany({
      where: {
        orgId,
        ...(q
          ? {
              OR: [
                { productName: { contains: q, mode: "insensitive" } },
                { productCode: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
                { manufacturer: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 201,
    });
    return jsonOk({ products: products.slice(0, 200), truncated: products.length > 200 });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const body = await readJson<Record<string, unknown>>(r);

    const productName = String(body.productName ?? "").trim();
    if (!productName) throw new DomainError("Product name is required", 400);

    const count = await db.product.count({ where: { orgId: ctx.orgId } });
    const productCode = body.productCode ? String(body.productCode).trim().slice(0, 40) : `PRD${700 + count + 1}`;

    const product = await db.product.create({
      data: {
        orgId: ctx.orgId,
        productCode,
        productName: productName.slice(0, 200),
        category: body.category ? String(body.category).trim().slice(0, 80) : null,
        manufacturer: body.manufacturer ? String(body.manufacturer).trim().slice(0, 120) : null,
        partNumber: body.partNumber ? String(body.partNumber).trim().slice(0, 80) : null,
        vendorId: body.vendorId ? String(body.vendorId) : null,
        isActive: body.isActive !== false,
        unitPrice: body.unitPrice ? Number(body.unitPrice) : null,
        currency: body.currency ? String(body.currency).trim().slice(0, 10) : "EUR",
        taxClass: body.taxClass ? String(body.taxClass).trim().slice(0, 40) : null,
        quantityInStock: body.quantityInStock ? Number(body.quantityInStock) : 0,
        reorderLevel: body.reorderLevel ? Number(body.reorderLevel) : null,
        quantityInDemand: body.quantityInDemand ? Number(body.quantityInDemand) : null,
        handlerId: body.handlerId ? String(body.handlerId) : null,
        description: body.description ? String(body.description).trim().slice(0, 4000) : null,
        productImage: body.productImage ? String(body.productImage).trim().slice(0, 400) : null,
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.product.created",
      target: product.id,
      after: { productName: product.productName, productCode: product.productCode },
      correlationId,
    });

    return jsonOk({ product }, 201);
  })(req);
}
