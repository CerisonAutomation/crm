"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Refund = {
  id: string; caseId: string; amount: number; currency: string; status: string; reason: string; createdAt: string;
};

const columns: ColumnDef<Refund>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "amount", header: "Amount", render: (r) => `${r.amount} ${r.currency}` },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "reason", header: "Reason", render: (r) => r.reason },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function RefundsPanel() {
  return (
    <EntityPanel<Refund>
      title="Refunds"
      eyebrow="Finance"
      fetchList={(qs) => api.listRefunds(qs)}
      fetchOne={(id) => api.getRefund(id)}
      createEntity={(p) => api.createRefund(p as { caseId: string; amount: number; currency: string; reason: string }) as unknown as Promise<{ [key: string]: Refund }>}
      updateEntity={(id, p) => api.updateRefund(id, p as { status: string }) as unknown as Promise<{ [key: string]: Refund }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "amount", label: "Amount", type: "number", required: true },
        { name: "currency", label: "Currency", required: true },
        { name: "reason", label: "Reason", required: true },
      ]}
      filterPlaceholder="Search refunds..."
    />
  );
}
