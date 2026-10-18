"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type PollConnection = {
  id: string; caseId: string; channel: string; status: string; lastPollAt: string | null; createdAt: string;
};

const columns: ColumnDef<PollConnection>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "channel", header: "Channel", render: (r) => r.channel },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "lastPollAt", header: "Last Poll", render: (r) => r.lastPollAt ?? "—" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function PollConnectionsPanel() {
  return (
    <EntityPanel<PollConnection>
      title="Poll Connections"
      eyebrow="Integrations"
      fetchList={(qs) => api.listPollConnections(qs)}
      fetchOne={(id) => api.getPollConnection(id)}
      createEntity={(p) => api.createPollConnection(p as { caseId: string; channel: string }) as unknown as Promise<{ [key: string]: PollConnection }>}
      updateEntity={(id, p) => api.updatePollConnection(id, p as { status: string }) as unknown as Promise<{ [key: string]: PollConnection }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "channel", label: "Channel", required: true },
      ]}
      filterPlaceholder="Search poll connections..."
    />
  );
}