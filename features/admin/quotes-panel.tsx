"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Quote = {
  id: string; caseId: string; amount: number; currency: string; status: string;
  validUntil: string | null; createdAt: string;
};

const columns: ColumnDef<Quote>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "amount", header: "Amount", render: (r) => `${r.amount} ${r.currency}` },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "validUntil", header: "Valid Until", render: (r) => r.validUntil ?? "—" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function QuotesPanel() {
  return (
    <EntityPanel<Quote>
      title="Quotes"
      eyebrow="Finance"
      fetchList={(qs) => api.listQuotes(qs)}
      fetchOne={(id) => api.getQuote(id)}
      createEntity={(p) => api.createQuote(p as { caseId: string; amount: number; currency: string; validUntil?: string }) as unknown as Promise<{ [key: string]: Quote }>}
      updateEntity={(id, p) => api.updateQuote(id, p as { status: string }) as unknown as Promise<{ [key: string]: Quote }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "amount", label: "Amount", type: "number", required: true },
        { name: "currency", label: "Currency", required: true },
        { name: "validUntil", label: "Valid Until" },
      ]}
      filterPlaceholder="Search quotes..."
    />
  );
}
