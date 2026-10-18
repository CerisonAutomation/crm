"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Party = {
  id: string; caseId: string; type: string; name: string; role: string; createdAt: string;
};

const columns: ColumnDef<Party>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "type", header: "Type", render: (r) => r.type },
  { key: "role", header: "Role", render: (r) => r.role },
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function PartiesPanel() {
  return (
    <EntityPanel<Party>
      title="Parties"
      eyebrow="Case Management"
      fetchList={(qs) => api.listParties(qs)}
      fetchOne={(id) => api.getParty(id)}
      createEntity={(p) => api.createParty(p as { caseId: string; type: string; name: string; role: string }) as unknown as Promise<{ [key: string]: Party }>}
      updateEntity={(id, p) => api.updateParty(id, p as { name?: string; role?: string }) as unknown as Promise<{ [key: string]: Party }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "type", label: "Type", required: true },
        { name: "name", label: "Name", required: true },
        { name: "role", label: "Role", required: true },
      ]}
      filterPlaceholder="Search parties..."
    />
  );
}
