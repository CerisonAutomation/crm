import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";

/**
 * PATCH /api/finance/[id] — invoice lifecycle (ADMIN / finance.write), with
 * dual-control on money (R5) and immutable invoices (BILL annex):
 *   APPROVE — second approval (finance.approve, DISTINCT actor) releasing a
 *     DRAFT at/above threshold to SENT.
 *   PAY — appends a Payment ledger row ONLY. Money fields (amountCents /
 *     title / lineItems) are never rewritten; the lifecycle status flips to
 *     PAID only when the ledger total covers the invoice.
 *   CREDIT_NOTE — the ONLY correction for SENT/PAID/OVERDUE (reason mandatory).
 *   VOID — DRAFT-only. A SENT/PAID invoice is immutable: voiding is rejected
 *     with 409 and the caller is directed to CREDIT_NOTE.
 * Client notification fires on SENT (approve), PAID / CREDITED only.
 * Every mutation is recorded via AuditEvent + OutboxEvent.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "finance.write");

    // Money gate lookup inside the caller org — every branch below inherits it.
    const invoice = await withTenantContext(ctx.orgId, (tx) =>
      tx.invoice.findUnique({
        where: { id },
        include: {
          payments: { select: { amountCents: true } },
          creditNotes: { select: { amountCents: true } },
        },
      })
    );
    if (!invoice || invoice.orgId !== ctx.orgId)
      throw new DomainError("Invoice not found", 404);

    const body = await readJson<{
      action?: string;
      method?: string;
      reference?: string;
      amountCents?: number;
      reason?: string;
    }>(r);
    switch (body.action) {
      case "APPROVE": {
        // Second half of dual-control: a DISTINCT actor holding
        // finance.approve releases a threshold DRAFT to SENT.
        requireCapability(ctx, "finance.approve");
        if (invoice.status !== "DRAFT")
          throw new DomainError(
            "Only a DRAFT invoice awaits second approval",
            409
          );
        if (invoice.primaryBy && invoice.primaryBy === ctx.userId) {
          await audit({
            orgId: ctx.orgId,
            actorId: ctx.userId,
            actorLabel: `${ctx.name} [${ctx.role}]`,
            action: "four-eyes.violation",
            target: invoice.number,
            after: { attempt: "finance.approve", primaryBy: invoice.primaryBy },
            reason: "Proposer attempted to second-approve their own invoice",
            correlationId,
          });
          throw new DomainError(
            "Four-eyes: the second approver must differ from the proposer",
            403
          );
        }
        const updated = await withTenantContext(ctx.orgId, (tx) =>
          tx.invoice.update({
            where: { id },
            data: {
              status: "SENT",
              approvedBy: ctx.userId,
              approvedAt: new Date(),
              issuedAt: invoice.issuedAt ?? new Date(),
            },
          })
        );
        await notifyUser({
          userId: invoice.clientId,
          title: `Invoice ${invoice.number}`,
          body: `${invoice.title}: ${(invoice.amountCents / 100).toFixed(2)} ${
            invoice.currency
          }, due ${updated.dueAt?.toISOString().slice(0, 10)}.`,
          category: "SYSTEM",
          caseId: invoice.caseId ?? undefined,
        });
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "finance.invoice.approved",
          target: invoice.number,
          after: { primaryBy: invoice.primaryBy, approvedBy: ctx.userId },
          correlationId,
        });
        await db.outboxEvent.create({
          data: {
            topic: "finance.invoice.approved",
            payload: JSON.stringify({
              invoiceId: invoice.id,
              number: invoice.number,
              orgId: invoice.orgId,
              primaryBy: invoice.primaryBy,
              approvedBy: ctx.userId,
            }),
            correlationId,
          },
        });
        return jsonOk({ invoice: updated });
      }
      case "PAY": {
        // Ledger-only: INSERT the payment, never rewrite the invoice's money
        // fields. A DRAFT still awaiting second approval cannot be paid.
        // (5) Retry safety FIRST: an Idempotency-Key replay returns the
        // original payment instead of double-charging — even when the
        // invoice has since moved on (guards below must not 409 a replay).
        const idemHeader = r.headers.get("idempotency-key")?.trim() || null;
        const scopeKey = idemHeader ? `finance-pay:${id}:${idemHeader}` : null;
        if (scopeKey) {
          const seen = await db.idempotencyKey.findUnique({
            where: { key: scopeKey },
          });
          if (seen?.resultRef) {
            const prior = await db.payment.findUnique({
              where: { id: seen.resultRef },
            });
            if (prior && prior.invoiceId === id) {
              const current = await db.invoice.findUnique({ where: { id } });
              return jsonOk({
                invoice: current ?? invoice,
                payment: prior,
                idempotent: true,
              });
            }
          }
        }
        if (invoice.status === "DRAFT")
          throw new DomainError(
            "Invoice awaits second approval (finance.approve) before payment",
            409
          );
        if (invoice.status === "VOID")
          throw new DomainError("Voided invoice cannot be paid", 409);
        if (invoice.status === "PAID")
          throw new DomainError("Invoice already paid", 409);
        // (1) Cap at outstanding: a partially-paid or credited invoice books
        // only what is still due — never the full face amount twice.
        const paidSoFar = invoice.payments.reduce(
          (s, p) => s + p.amountCents,
          0
        );
        const creditedSoFar = invoice.creditNotes.reduce(
          (s, c) => s + c.amountCents,
          0
        );
        const outstanding = invoice.amountCents - paidSoFar - creditedSoFar;
        if (outstanding <= 0)
          throw new DomainError(
            "No outstanding balance — credits cover the remainder",
            409
          );
        const payCents = Math.min(invoice.amountCents, outstanding);
        const method = body.method ?? "TRANSFER";
        if (!["TRANSFER", "CARD", "QR_BILL"].includes(method)) {
          throw new DomainError(
            "Unknown payment method — expected TRANSFER, CARD or QR_BILL",
            400
          );
        }
        if (scopeKey) {
          if (
            await db.idempotencyKey.findUnique({ where: { key: scopeKey } })
          ) {
            throw new DomainError(
              "Payment already processing for this idempotency key",
              409
            );
          }
          try {
            await db.idempotencyKey.create({
              data: { key: scopeKey, scope: "finance-pay" },
            });
          } catch (e) {
            if ((e as { code?: string })?.code === "P2002")
              throw new DomainError(
                "Payment already processing for this idempotency key",
                409
              );
            throw e;
          }
        }
        let payment;
        try {
          payment = await withTenantContext(ctx.orgId, (tx) =>
            tx.payment.create({
              data: {
                invoiceId: id,
                orgId: invoice.orgId,
                amountCents: payCents,
                currency: invoice.currency,
                method,
                reference: body.reference ?? null,
              },
            })
          );
        } catch (e) {
          // Never leave a resultRef-less reservation behind: it would wedge
          // every retry on "already processing".
          if (scopeKey)
            await db.idempotencyKey
              .delete({ where: { key: scopeKey } })
              .catch(() => undefined);
          throw e;
        }
        if (scopeKey)
          await db.idempotencyKey
            .update({
              where: { key: scopeKey },
              data: { resultRef: payment.id },
            })
            .catch(() => undefined);
        // Lifecycle status is DERIVED from the ledger: PAID only when total
        // payments cover the invoiced amount (net of credit notes).
        const paidTotal = paidSoFar + payCents;
        const creditedTotal = creditedSoFar;
        const fullyPaid = paidTotal >= invoice.amountCents - creditedTotal;
        const updated = fullyPaid
          ? await withTenantContext(ctx.orgId, (tx) =>
              tx.invoice.update({
                where: { id },
                data: { status: "PAID", paidAt: new Date() },
              })
            )
          : invoice;
        if (fullyPaid) {
          await notifyUser({
            userId: invoice.clientId,
            title: `Payment received — ${invoice.number}`,
            body: `${(payment.amountCents / 100).toFixed(2)} ${
              invoice.currency
            } received. Thank you.`,
            category: "SYSTEM",
            caseId: invoice.caseId ?? undefined,
          });
        }
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "finance.invoice.paid",
          target: invoice.number,
          after: {
            method: body.method ?? "TRANSFER",
            paymentId: payment.id,
            amountCents: payment.amountCents,
            paidTotal,
            fullyPaid,
          },
          correlationId,
        });
        await db.outboxEvent.create({
          data: {
            topic: "finance.invoice.paid",
            payload: JSON.stringify({
              invoiceId: invoice.id,
              number: invoice.number,
              orgId: invoice.orgId,
              paymentId: payment.id,
              amountCents: payment.amountCents,
              currency: payment.currency,
              method: payment.method,
              fullyPaid,
            }),
            correlationId,
          },
        });
        // Canonical hook: invoice-receipt workflows (trigger.invoice.paid) fire
        // on payment — fire-and-forget, deduped by the payment ledger row so a
        // replayed PAY never double-receipts.
        const { startRunsForTrigger } = await import(
          "@/lib/services/workflow-engine"
        );
        void startRunsForTrigger("trigger.invoice.paid", {
          trigger: "invoice.paid",
          caseId: invoice.caseId ?? undefined,
          context: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            invoiceTitle: invoice.title,
            amountCents: invoice.amountCents,
            currency: invoice.currency,
            method: payment.method,
            paymentId: payment.id,
            paidAt: (updated.paidAt ?? new Date()).toISOString(),
          },
          actorLabel: `${ctx.name} [${ctx.role}]`,
          correlationId,
          orgId: ctx.orgId,
          dedupeKey: payment.id,
        }).catch(() => undefined);
        return jsonOk({ invoice: updated, payment });
      }
      case "CREDIT_NOTE": {
        // The ONLY correction path for a live invoice: append an immutable
        // credit-note row. The invoice's money fields are never rewritten.
        if (invoice.status === "DRAFT")
          throw new DomainError(
            "DRAFT invoices carry no charge yet — VOID instead",
            409
          );
        if (invoice.status === "VOID")
          throw new DomainError("Voided invoice cannot be credited", 409);
        const reason = body.reason?.trim();
        if (!reason)
          throw new DomainError("A credit-note reason is mandatory", 400);
        const creditCents = Math.round(Number(body.amountCents ?? 0));
        if (!Number.isFinite(creditCents) || creditCents <= 0)
          throw new DomainError("amountCents must be positive", 400);
        const paidTotal = invoice.payments.reduce(
          (s, p) => s + p.amountCents,
          0
        );
        const creditedTotal = invoice.creditNotes.reduce(
          (s, c) => s + c.amountCents,
          0
        );
        const outstanding = invoice.amountCents - paidTotal - creditedTotal;
        if (creditCents > outstanding)
          throw new DomainError("Credit exceeds the outstanding balance", 400);
        const note = await withTenantContext(ctx.orgId, (tx) =>
          tx.creditNote.create({
            data: {
              invoiceId: id,
              orgId: invoice.orgId,
              amountCents: creditCents,
              currency: invoice.currency,
              reason,
              actorId: ctx.userId,
            },
          })
        );
        const fullyCredited = creditCents >= outstanding;
        const updated = fullyCredited
          ? await withTenantContext(ctx.orgId, (tx) =>
              tx.invoice.update({ where: { id }, data: { status: "CREDITED" } })
            )
          : invoice;
        if (fullyCredited) {
          await notifyUser({
            userId: invoice.clientId,
            title: `Invoice ${invoice.number} credited`,
            body: `${invoice.title} was fully credited — no payment is due.`,
            category: "SYSTEM",
            caseId: invoice.caseId ?? undefined,
          });
        }
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "finance.invoice.credited",
          target: invoice.number,
          after: {
            creditNoteId: note.id,
            amountCents: creditCents,
            fullyCredited,
          },
          reason,
          correlationId,
        });
        await db.outboxEvent.create({
          data: {
            topic: "finance.invoice.credited",
            payload: JSON.stringify({
              invoiceId: invoice.id,
              number: invoice.number,
              orgId: invoice.orgId,
              creditNoteId: note.id,
              amountCents: creditCents,
              currency: note.currency,
              reason,
              fullyCredited,
            }),
            correlationId,
          },
        });
        return jsonOk({ invoice: updated, creditNote: note }, 201);
      }
      case "VOID": {
        // Immutable once live: only a DRAFT (never issued) may be voided.
        // SENT/PAID/OVERDUE/CREDITED corrections go through CREDIT_NOTE.
        if (invoice.status !== "DRAFT") {
          throw new DomainError(
            "Invoice is immutable once sent — issue a credit note (CREDIT_NOTE) instead of voiding",
            409
          );
        }
        const updated = await withTenantContext(ctx.orgId, (tx) =>
          tx.invoice.update({ where: { id }, data: { status: "VOID" } })
        );
        await notifyUser({
          userId: invoice.clientId,
          title: `Invoice ${invoice.number} voided`,
          body: `${invoice.title} was voided — no payment is due.`,
          category: "SYSTEM",
          caseId: invoice.caseId ?? undefined,
        });
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "finance.invoice.voided",
          target: invoice.number,
          correlationId,
        });
        await db.outboxEvent.create({
          data: {
            topic: "finance.invoice.voided",
            payload: JSON.stringify({
              invoiceId: invoice.id,
              number: invoice.number,
              orgId: invoice.orgId,
            }),
            correlationId,
          },
        });
        return jsonOk({ invoice: updated });
      }
      default:
        throw new DomainError(
          "Unknown action — expected APPROVE, PAY, CREDIT_NOTE or VOID",
          400
        );
    }
  })(req);
}
