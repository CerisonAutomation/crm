"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type MergeEntry = {
  id: string; caseId: string; source: string; target: string; reason: string; createdAt: string;
};

const columns: ColumnDef<MergeEntry>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "source", header: "Source", render: (r) => r.source },
  { key: "target", header: "Target", render: (r) => r.target },
  { key: "reason", header: "Reason", render: (r) => r.reason },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function MergeLedgerPanel() {
  return (
    <EntityPanel<MergeEntry>
      title="Merge Ledger"
      eyebrow="Case Management"
      fetchList={(qs) => api.listMergeLedger(qs)}
      columns={columns}
      filterPlaceholder="Search merge ledger..."
    />
  );
}
