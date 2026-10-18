import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";
import {
  FINANCE_DUAL_CONTROL_THRESHOLD_CENTS,
  requiresSecondApproval,
} from "./_policy";

/**
 * GET /api/finance — finance ledger, role-scoped:
 *   CLIENT sees own invoices; RM/SENIOR_RM/ADMIN/AUDITOR see the org book.
 *   `?caseId=` adds a per-case P&L summary (invoiced / paid / credited /
 *   LLM cost via AiRun.costMillicents exact, S4 / net).
 * POST /api/finance — create an invoice (ADMIN or finance.write).
 *   At or above FINANCE_DUAL_CONTROL_THRESHOLD_CENTS the invoice is created
 *   as DRAFT and needs a DISTINCT finance.approve second approval before it
 *   may be SENT/PAID (dual-control, R5). Below threshold it is SENT at once.
 *   Amounts are minor units and frozen once SENT — corrections are
 *   credit-note rows only (BILL annex).
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const own = ctx.role === "CLIENT";
    const caseId = r.nextUrl.searchParams.get("caseId");
    const scope = own ? { clientId: ctx.userId } : { orgId: ctx.orgId };
    // Ledger reads resolve inside the caller org (CLIENT scope is own rows).
    const invoices = await withTenantContext(ctx.orgId, (tx) =>
      tx.invoice.findMany({
        where: caseId ? { ...scope, caseId } : scope,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          payments: {
            select: {
              amountCents: true,
              method: true,
              receivedAt: true,
              reference: true,
            },
          },
          creditNotes: {
            select: { amountCents: true, reason: true, createdAt: true },
          },
        },
      })
    );
    if (caseId) {
      // Per-case P&L read path is object-authorised: a client may only read
      // their own case; staff only within their organisation.
      const kase = await withTenantContext(ctx.orgId, (tx) =>
        tx.case.findUnique({
          where: { id: caseId },
          select: { id: true, clientId: true, orgId: true },
        })
      );
      if (!kase) throw new DomainError("Case not found", 404);
      if (own && kase.clientId !== ctx.userId)
        throw new DomainError("Forbidden", 403);
      if (!own && kase.orgId !== ctx.orgId)
        throw new DomainError("Forbidden", 403);
      const invoicedCents = invoices.reduce((s, i) => s + i.amountCents, 0);
      const paidCents = invoices
        .flatMap((i) => i.payments)
        .reduce((s, p) => s + p.amountCents, 0);
      const creditedCents = invoices
        .flatMap((i) => i.creditNotes)
        .reduce((s, c) => s + c.amountCents, 0);
      // S4: exact millis (epoch-backfilled), no CEIL bias in the total.
      const aiCostMillis =
        (
          await db.aiRun.aggregate({
            where: { caseId },
            _sum: { costMillicents: true },
          })
        )._sum.costMillicents ?? 0;
      const aiCostCents = Math.round((aiCostMillis / 1000) * 1000) / 1000;
      return jsonOk({
        invoices,
        summary: {
          count: invoices.length,
          paidCents,
          openCents: Math.max(0, invoicedCents - paidCents - creditedCents),
        },
        pl: {
          caseId,
          invoicedCents,
          paidCents,
          creditedCents,
          aiCostCents,
          netCents: paidCents - creditedCents - aiCostCents,
        },
      });
    }
    const paidCents = invoices
      .filter((i) => i.status === "PAID")
      .reduce((s, i) => s + i.amountCents, 0);
    const openCents = invoices
      .filter((i) => ["SENT", "OVERDUE"].includes(i.status))
      .reduce((s, i) => s + i.amountCents, 0);
    const creditedCents = invoices
      .flatMap((i) => i.creditNotes)
      .reduce((s, c) => s + c.amountCents, 0);
    return jsonOk({
      invoices,
      summary: { count: invoices.length, paidCents, openCents, creditedCents },
    });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "finance.write");

    const body = await readJson<{
      clientId?: string;
      caseId?: string;
      title?: string;
      amountCents?: number;
      currency?: string;
      dueDays?: number;
      lineItems?: Array<{ label?: string; amountCents?: number }>;
      notes?: string;
    }>(r);
    const amountCents = Math.round(Number(body.amountCents ?? 0));
    if (!body.clientId) throw new DomainError("clientId required", 400);
    if (!body.title) throw new DomainError("title required", 400);
    const clientId: string = body.clientId;
    const title: string = body.title;
    if (!Number.isFinite(amountCents) || amountCents <= 0)
      throw new DomainError("amountCents must be positive", 400);
    const dueDays = body.dueDays ?? 30;
    if (!Number.isFinite(dueDays) || dueDays < 0)
      throw new DomainError("dueDays must be zero or positive", 400);
    if (body.lineItems !== undefined) {
      if (!Array.isArray(body.lineItems) || body.lineItems.length === 0)
        throw new DomainError("lineItems must be a non-empty array", 400);
      let lineSum = 0;
      for (const li of body.lineItems) {
        const c = Math.round(Number(li?.amountCents ?? NaN));
        if (
          !li ||
          typeof li.label !== "string" ||
          !li.label.trim() ||
          !Number.isFinite(c) ||
          c < 0
        ) {
          throw new DomainError(
            "Each line item needs a label and a non-negative amountCents",
            400
          );
        }
        lineSum += c;
      }
      if (lineSum !== amountCents)
        throw new DomainError("Line items must sum to amountCents", 400);
    }

    const client = await withTenantContext(ctx.orgId, (tx) =>
      tx.user.findUnique({
        where: { id: clientId },
        select: { id: true, orgId: true },
      })
    );
    if (!client || client.orgId !== ctx.orgId)
      throw new DomainError("Client not in your organisation", 403);

    // Dual-control (R5): at/above threshold the invoice starts as DRAFT and
    // waits for a DISTINCT finance.approve second approval (see PATCH
    // APPROVE). The proposer is recorded as primaryBy at creation time.
    const needsSecondApproval = requiresSecondApproval(amountCents);
    const status = needsSecondApproval ? "DRAFT" : "SENT";

    // Sequence from the highest existing number for the year (deletion-safe) —
    // never a row count, which would reuse/duplicate a number after a removal.
    const year = new Date().getFullYear();
    const prefix = `CLF-${year}-`;
    // Number sequencing reads run inside the caller org; the P2002 retry
    // below keeps its exact semantics (unique-violation loser re-reads).
    const last = await withTenantContext(ctx.orgId, (tx) =>
      tx.invoice.findFirst({
        where: { orgId: ctx.orgId, number: { startsWith: prefix } },
        orderBy: { number: "desc" },
        select: { number: true },
      })
    );
    // Retry the read-then-save up to 3x: two concurrent POSTs can compute
    // the same seq — the unique-violation loser re-reads and retries.
    let invoice: Awaited<ReturnType<typeof db.invoice.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest =
        attempt === 0
          ? last
          : await withTenantContext(ctx.orgId, (tx) =>
              tx.invoice.findFirst({
                where: { orgId: ctx.orgId, number: { startsWith: prefix } },
                orderBy: { number: "desc" },
                select: { number: true },
              })
            );
      const seq =
        (latest ? Number(latest.number.slice(prefix.length)) || 0 : 0) + 1;
      try {
        invoice = await withTenantContext(ctx.orgId, (tx) =>
          tx.invoice.create({
            data: {
              number: `CLF-${new Date().getFullYear()}-${String(seq).padStart(
                4,
                "0"
              )}`,
              orgId: ctx.orgId,
              clientId,
              caseId: body.caseId ?? null,
              title,
              currency: body.currency ?? "CHF",
              amountCents,
              status,
              primaryBy: ctx.userId,
              notes: body.notes ?? null,
              lineItems: body.lineItems ? JSON.stringify(body.lineItems) : null,
              issuedAt: status === "SENT" ? new Date() : null,
              dueAt: new Date(Date.now() + dueDays * 86_400_000),
            },
          })
        );
        break;
      } catch (e) {
        if (attempt >= 2 || (e as { code?: string })?.code !== "P2002") throw e;
      }
    }
    if (!invoice)
      throw new DomainError("Could not issue a unique invoice number", 503);

    // The client is notified only when payment is actually due (SENT). A
    // DRAFT above threshold notifies on APPROVE instead.
    if (status === "SENT") {
      await notifyUser({
        userId: invoice.clientId,
        title: `Invoice ${invoice.number}`,
        body: `${invoice.title}: ${(invoice.amountCents / 100).toFixed(2)} ${
          invoice.currency
        }, due ${invoice.dueAt?.toISOString().slice(0, 10)}.`,
        category: "SYSTEM",
        caseId: invoice.caseId ?? undefined,
      });
    }

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "finance.invoice.created",
      target: invoice.number,
      after: {
        amountCents,
        currency: invoice.currency,
        status,
        needsSecondApproval,
        thresholdCents: FINANCE_DUAL_CONTROL_THRESHOLD_CENTS,
      },
      correlationId,
    });
    await db.outboxEvent.create({
      data: {
        topic: "finance.invoice.created",
        payload: JSON.stringify({
          invoiceId: invoice.id,
          number: invoice.number,
          orgId: ctx.orgId,
          clientId: invoice.clientId,
          caseId: invoice.caseId,
          amountCents,
          currency: invoice.currency,
          status,
          primaryBy: ctx.userId,
          needsSecondApproval,
        }),
        correlationId,
      },
    });
    return jsonOk({ invoice }, 201);
  })(req);
}
