// H2 port — billing contract (Prisma-free, import anywhere).
// Invoices are immutable; corrections are credit notes only (Annex BILL).
// Amounts are minor units. H3 offline/manual default records intent without
// touching money — reconciliation happens against provider receipts.

export type MoneyMinor = { amount: number; currency: string };

export type InvoiceIntent = {
  caseId: string;
  lines: Array<MoneyMinor & { label: string }>;
  idempotencyKey: string;
};

export type InvoiceResult =
  | { ok: true; invoiceRef: string }
  | { ok: false; reason: string };

export interface BillingProvider {
  readonly name: string;
  issueInvoice(intent: InvoiceIntent): Promise<InvoiceResult>;
}

export const offlineBillingProvider: BillingProvider = {
  name: "manual",
  issueInvoice: async (intent) => ({
    ok: true,
    invoiceRef: `manual:${intent.caseId}:${intent.idempotencyKey}`,
  }),
};
