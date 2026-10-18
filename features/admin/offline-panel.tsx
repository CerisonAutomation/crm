"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type OfflineQueueItem = {
  id: string; action: string; payload: Record<string, unknown>; status: string; createdAt: string;
};

const columns: ColumnDef<OfflineQueueItem>[] = [
  { key: "action", header: "Action", render: (r) => r.action },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function OfflinePanel() {
  return (
    <EntityPanel<OfflineQueueItem>
      title="Offline Queue"
      eyebrow="Offline Sync"
      fetchList={(qs) => api.listOfflineQueue(qs)}
      columns={columns}
      filterPlaceholder="Search offline queue..."
    />
  );
}