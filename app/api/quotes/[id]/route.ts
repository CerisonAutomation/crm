import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteQuote, getQuote, updateQuote } from "@/lib/services/quote";
import { notFound } from "@/lib/api-errors";

async function ownedQuote(id: string, orgId: string) {
  const quote = await getQuote(id);
  if (!quote || quote.orgId !== orgId) throw notFound("Quote not found");
  return quote;
}

// GET /api/quotes/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    const quote = await ownedQuote(id, ctx.orgId);
    return jsonOk({ quote });
  })(req);
}

// PATCH /api/quotes/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedQuote(id, ctx.orgId);
    const body = await readJson<{
      title?: string;
      currency?: string;
      amountCents?: number;
      status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
      validUntil?: string;
      notes?: string;
    }>(r);
    const quote = await updateQuote(id, {
      title: body?.title,
      currency: body?.currency,
      amountCents: body?.amountCents,
      status: body?.status,
      validUntil: body?.validUntil ? new Date(body.validUntil) : undefined,
      notes: body?.notes,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "quote.updated",
      target: quote.id,
      after: body,
      correlationId,
    });
    return jsonOk({ quote });
  })(req);
}

// DELETE /api/quotes/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedQuote(id, ctx.orgId);
    await deleteQuote(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "quote.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
