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
    const potential = await db.potential.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { account: { select: { id: true, name: true } }, contact: { select: { id: true, name: true } } },
    });
    if (!potential) throw new DomainError("Potential not found", 404);
    return jsonOk({ potential });
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(r);

    const existing = await db.potential.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Potential not found", 404);

    const potential = await db.potential.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name).trim().slice(0, 200) } : undefined),
        ...(body.accountId !== undefined ? { accountId: body.accountId ? String(body.accountId) : null } : undefined),
        ...(body.contactId !== undefined ? { contactId: body.contactId ? String(body.contactId) : null } : undefined),
        ...(body.leadId !== undefined ? { leadId: body.leadId ? String(body.leadId) : null } : undefined),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId ? String(body.ownerId) : null } : undefined),
        ...(body.opportunityType !== undefined ? { opportunityType: body.opportunityType ? String(body.opportunityType).trim().slice(0, 80) : null } : undefined),
        ...(body.leadsource !== undefined ? { leadsource: body.leadsource ? String(body.leadsource).trim().slice(0, 80) : null } : undefined),
        ...(body.stage !== undefined ? { stage: body.stage ? String(body.stage).trim().slice(0, 40) : null } : undefined),
        ...(body.probability !== undefined ? { probability: body.probability ? Number(body.probability) : null } : undefined),
        ...(body.amount !== undefined ? { amount: body.amount ? Number(body.amount) : null } : undefined),
        ...(body.currency !== undefined ? { currency: body.currency ? String(body.currency).trim().slice(0, 10) : null } : undefined),
        ...(body.closingDate !== undefined ? { closingDate: body.closingDate ? new Date(String(body.closingDate)) : null } : undefined),
        ...(body.nextstep !== undefined ? { nextstep: body.nextstep ? String(body.nextstep).trim().slice(0, 4000) : null } : undefined),
        ...(body.description !== undefined ? { description: body.description ? String(body.description).trim().slice(0, 4000) : null } : undefined),
        ...(body.isClosed !== undefined ? { isClosed: body.isClosed === true } : undefined),
        ...(body.isWon !== undefined ? { isWon: body.isWon === true } : undefined),
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.potential.updated",
      target: potential.id,
      before: { name: existing.name, stage: existing.stage },
      after: { name: potential.name, stage: potential.stage },
      correlationId,
    });

    return jsonOk({ potential });
  })(req);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const { id } = await params;

    const existing = await db.potential.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Potential not found", 404);

    await db.potential.delete({ where: { id } });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "crm.potential.deleted",
      target: id,
      before: { name: existing.name },
      correlationId,
    });

    return jsonOk({ ok: true });
  })(req);
}
