/**
 * Invoice dunning (Annex BILL: dunning on runner).
 *
 * SENT invoices past their dueAt flip to OVERDUE with a client notice and a
 * `finance.invoice.overdue` audit event. Idempotent: the flip is a conditional
 * updateMany (status still SENT), so a replayed sweep never double-notifies.
 * DRAFT invoices are never touched - they belong to the dual-control flow.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import { notifyUser } from "@/lib/services/notify";

/** Pure: is this invoice shape actionable for dunning right now? */
export function isInvoiceOverdue(status: string, dueAt: Date | null, nowMs: number): boolean {
  if (status !== "SENT" || !dueAt) return false;
  return dueAt.getTime() < nowMs;
}

/** Pure: the client notice for one overdue invoice (minor units formatted). */
export function dunningBody(input: { number: string; title: string; amountCents: number; currency: string; dueAt: Date }): string {
  const amount = (input.amountCents / 100).toFixed(2);
  const day = input.dueAt.toISOString().slice(0, 10);
  return input.title + " (" + input.number + "): " + amount + " " + input.currency + " was due " + day + ". Please pay or contact us.";
}

/** Invoices without a due date fall back to created+30d (never dunned before). */
export const DUNNING_NULL_DUE_GRACE_MS = 30 * 86_400_000;

/** One sweep pass over past-due SENT invoices. Failures are contained per invoice. */
export async function sweepDunning(now = new Date()): Promise<{ overdue: number }> {
  let overdue = 0;
  const graceCutoff = new Date(now.getTime() - DUNNING_NULL_DUE_GRACE_MS);
  const rows = await db.invoice.findMany({
    where: { status: "SENT", OR: [{ dueAt: { lt: now } }, { dueAt: null, createdAt: { lt: graceCutoff } }] },
    select: { id: true, number: true, orgId: true, clientId: true, caseId: true, title: true, amountCents: true, currency: true, dueAt: true, createdAt: true },
    take: 100,
  });
  for (const inv of rows) {
    try {
      const flipped = await db.invoice.updateMany({ where: { id: inv.id, status: "SENT" }, data: { status: "OVERDUE" } });
      if (flipped.count === 0) continue; // lost the race - another sweep flipped it
      overdue++;
      const effectiveDue = inv.dueAt ?? (inv.createdAt ? new Date(inv.createdAt.getTime() + DUNNING_NULL_DUE_GRACE_MS) : null);
      if (effectiveDue) {
        await notifyUser({
          userId: inv.clientId,
          title: "Invoice " + inv.number + " overdue",
          body: dunningBody({ number: inv.number, title: inv.title, amountCents: inv.amountCents, currency: inv.currency, dueAt: effectiveDue }),
          category: "SYSTEM",
          caseId: inv.caseId ?? undefined,
        });
      }
      await audit({ orgId: inv.orgId, action: "finance.invoice.overdue", target: inv.number, after: { amountCents: inv.amountCents } });
    } catch (err) {
      console.error("[dunning] invoice " + inv.id + " failed", err);
      await audit({
        orgId: inv.orgId,
        action: "finance.dunning.notify_failed",
        target: inv.number,
        reason: err instanceof Error ? err.message.slice(0, 500) : "unknown dunning failure",
      });
    }
  }
  return { overdue };
}

