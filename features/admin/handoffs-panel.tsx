"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Handoff = {
  id: string; caseId: string; fromUserId: string; toUserId: string; reason: string; status: string; createdAt: string;
};

const columns: ColumnDef<Handoff>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "fromUserId", header: "From", render: (r) => r.fromUserId },
  { key: "toUserId", header: "To", render: (r) => r.toUserId },
  { key: "reason", header: "Reason", render: (r) => r.reason },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function HandoffsPanel() {
  return (
    <EntityPanel<Handoff>
      title="Handoffs"
      eyebrow="Case Management"
      fetchList={(qs) => api.listHandoffs(qs)}
      fetchOne={(id) => api.getHandoff(id)}
      createEntity={(p) => api.createHandoff(p as { caseId: string; toUserId: string; reason: string }) as unknown as Promise<{ [key: string]: Handoff }>}
      updateEntity={(id, p) => api.updateHandoff(id, p as { status: string }) as unknown as Promise<{ [key: string]: Handoff }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "toUserId", label: "To User ID", required: true },
        { name: "reason", label: "Reason", required: true },
      ]}
      filterPlaceholder="Search handoffs..."
    />
  );
}
