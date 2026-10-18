"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type WebhookInboxEntry = {
  id: string; topic: string; status: string; createdAt: string;
};

const columns: ColumnDef<WebhookInboxEntry>[] = [
  { key: "topic", header: "Topic", render: (r) => r.topic },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function WebhookInboxPanel() {
  return (
    <EntityPanel<WebhookInboxEntry>
      title="Webhook Inbox"
      eyebrow="Integrations"
      fetchList={(qs) => api.listWebhookInbox(qs)}
      fetchOne={(id) => api.getWebhookInboxEntry(id)}
      columns={columns}
      filterPlaceholder="Search webhook inbox..."
    />
  );
}