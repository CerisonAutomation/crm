/**
 * Dual-control policy for money movement (BILL annex, R5 four-eyes).
 *
 * Invoices at or above the threshold are created as DRAFT and need a DISTINCT
 * second approver holding `finance.approve` before they may be SENT/PAID.
 * `finance.write` proposes; `finance.approve` disposes — the same actor can
 * never satisfy both halves (enforced in the route with 403 + a
 * `four-eyes.violation` audit event).
 *
 * Corrections to a SENT/PAID invoice are credit-note rows ONLY — the invoice
 * row's money fields (amountCents/title/lineItems) are frozen once SENT.
 * All amounts are minor units (cents), immutable per BILL.
 */
export const FINANCE_DUAL_CONTROL_THRESHOLD_CENTS = 500_000; // CHF 5,000

export function requiresSecondApproval(amountCents: number): boolean {
  return Number.isFinite(amountCents) && amountCents >= FINANCE_DUAL_CONTROL_THRESHOLD_CENTS;
}
