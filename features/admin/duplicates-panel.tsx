"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Duplicate = {
  id: string; caseId: string; status: string; confidence: number; createdAt: string;
};

const columns: ColumnDef<Duplicate>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "confidence", header: "Confidence", render: (r) => `${(r.confidence * 100).toFixed(0)}%` },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function DuplicatesPanel() {
  return (
    <EntityPanel<Duplicate>
      title="Duplicates"
      eyebrow="Case Management"
      fetchList={(qs) => api.listDuplicates(qs)}
      fetchOne={(id) => api.getDuplicate(id)}
      createEntity={(p) => api.createDuplicate(p as { caseId: string; confidence: number }) as unknown as Promise<{ [key: string]: Duplicate }>}
      updateEntity={(id, p) => api.updateDuplicate(id, p as { status: string }) as unknown as Promise<{ [key: string]: Duplicate }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "confidence", label: "Confidence", type: "number", required: true },
      ]}
      filterPlaceholder="Search duplicates..."
    />
  );
}
