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
    const salesOrder = await db.salesOrder.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
    });
    if (!salesOrder) throw new DomainError("Sales order not found", 404);
    return jsonOk({ salesOrder });
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(r);

    const existing = await db.salesOrder.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Sales order not found", 404);

    const salesOrder = await db.salesOrder.update({
      where: { id },
      data: {
        ...(body.subject !== undefined ? { subject: String(body.subject).trim().slice(0, 200) } : {}),
        ...(body.accountId !== undefined ? { accountId: body.accountId ? String(body.accountId) : null } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId ? String(body.contactId) : null } : {}),
        ...(body.status !== undefined ? { status: body.status ? String(body.status).trim().slice(0, 40) : null } : {}),
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? new Date(String(body.dueDate)) : null } : {}),
        ...(body.carrier !== undefined ? { carrier: body.carrier ? String(body.carrier).trim().slice(0, 80) : null } : {}),
        ...(body.total !== undefined ? { total: body.total ? Number(body.total) : null } : {}),
        ...(body.currency !== undefined ? { currency: body.currency ? String(body.currency).trim().slice(0, 10) : null } : {}),
        ...(body.description !== undefined ? { description: body.description ? String(body.description).trim().slice(0, 4000) : null } : {}),
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.salesorder.updated",
      target: salesOrder.id,
      before: { subject: existing.subject, status: existing.status },
      after: { subject: salesOrder.subject, status: salesOrder.status },
      correlationId,
    });

    return jsonOk({ salesOrder });
  })(req);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;

    const existing = await db.salesOrder.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Sales order not found", 404);

    await db.salesOrder.delete({ where: { id } });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.salesorder.deleted",
      target: id,
      before: { subject: existing.subject },
      correlationId,
    });

    return jsonOk({ ok: true });
  })(req);
}
