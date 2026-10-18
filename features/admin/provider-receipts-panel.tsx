"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type ProviderReceipt = {
  id: string; caseId: string; provider: string; amount: number; currency: string; status: string; createdAt: string;
};

const columns: ColumnDef<ProviderReceipt>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "provider", header: "Provider", render: (r) => r.provider },
  { key: "amount", header: "Amount", render: (r) => `${r.amount} ${r.currency}` },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function ProviderReceiptsPanel() {
  return (
    <EntityPanel<ProviderReceipt>
      title="Provider Receipts"
      eyebrow="Finance"
      fetchList={(qs) => api.listProviderReceipts(qs)}
      fetchOne={(id) => api.getProviderReceipt(id)}
      createEntity={(p) => api.createProviderReceipt(p as { caseId: string; provider: string; amount: number; currency: string }) as unknown as Promise<{ [key: string]: ProviderReceipt }>}
      updateEntity={(id, p) => api.updateProviderReceipt(id, p as { status: string }) as unknown as Promise<{ [key: string]: ProviderReceipt }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "provider", label: "Provider", required: true },
        { name: "amount", label: "Amount", type: "number", required: true },
        { name: "currency", label: "Currency", required: true },
      ]}
      filterPlaceholder="Search provider receipts..."
    />
  );
}
