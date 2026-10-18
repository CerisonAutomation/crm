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
    const product = await db.product.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!product) throw new DomainError("Product not found", 404);
    return jsonOk({ product });
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(r);

    const existing = await db.product.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Product not found", 404);

    const product = await db.product.update({
      where: { id },
      data: {
        ...(body.productName !== undefined ? { productName: String(body.productName).trim().slice(0, 200) } : undefined),
        ...(body.productCode !== undefined ? { productCode: body.productCode ? String(body.productCode).trim().slice(0, 40) : null } : undefined),
        ...(body.category !== undefined ? { category: body.category ? String(body.category).trim().slice(0, 80) : null } : undefined),
        ...(body.manufacturer !== undefined ? { manufacturer: body.manufacturer ? String(body.manufacturer).trim().slice(0, 120) : null } : undefined),
        ...(body.partNumber !== undefined ? { partNumber: body.partNumber ? String(body.partNumber).trim().slice(0, 80) : null } : undefined),
        ...(body.isActive !== undefined ? { isActive: body.isActive === true } : undefined),
        ...(body.unitPrice !== undefined ? { unitPrice: body.unitPrice ? Number(body.unitPrice) : null } : undefined),
        ...(body.currency !== undefined ? { currency: body.currency ? String(body.currency).trim().slice(0, 10) : null } : undefined),
        ...(body.taxClass !== undefined ? { taxClass: body.taxClass ? String(body.taxClass).trim().slice(0, 40) : null } : undefined),
        ...(body.quantityInStock !== undefined ? { quantityInStock: body.quantityInStock ? Number(body.quantityInStock) : null } : undefined),
        ...(body.reorderLevel !== undefined ? { reorderLevel: body.reorderLevel ? Number(body.reorderLevel) : null } : undefined),
        ...(body.description !== undefined ? { description: body.description ? String(body.description).trim().slice(0, 4000) : null } : undefined),
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.product.updated",
      target: product.id,
      before: { productName: existing.productName },
      after: { productName: product.productName },
      correlationId,
    });

    return jsonOk({ product });
  })(req);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;

    const existing = await db.product.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Product not found", 404);

    await db.product.delete({ where: { id } });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.product.deleted",
      target: id,
      before: { productName: existing.productName },
      correlationId,
    });

    return jsonOk({ ok: true });
  })(req);
}
