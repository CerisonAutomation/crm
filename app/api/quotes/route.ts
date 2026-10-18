import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createQuote, getQuotes } from "@/lib/services/quote";
import { validationFailed } from "@/lib/api-errors";

// GET /api/quotes?caseId=&status=
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const quotes = await getQuotes(ctx.orgId, {
      caseId: q.get("caseId") || undefined,
      status: q.get("status") || undefined,
    });
    return jsonOk({ quotes });
  })(req);
}

// POST /api/quotes
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      number?: string;
      title?: string;
      amountCents?: number;
      currency?: string;
      validUntil?: string;
      notes?: string;
      caseId?: string;
    }>(r);
    if (!body?.number) throw validationFailed("number is required");
    if (!body?.title) throw validationFailed("title is required");
    if (body?.amountCents === undefined) throw validationFailed("amountCents is required");
    const quote = await createQuote({
      orgId: ctx.orgId,
      number: body.number,
      title: body.title,
      amountCents: body.amountCents,
      currency: body.currency,
      validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
      notes: body.notes,
      caseId: body.caseId,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "quote.created",
      target: quote.id,
      after: { number: quote.number, amountCents: quote.amountCents },
      correlationId,
    });
    return jsonOk({ quote }, 201);
  })(req);
}
