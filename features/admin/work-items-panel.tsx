"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type WorkItem = {
  id: string; caseId: string; title: string; status: string; priority: string;
  assignee: string | null; dueAt: string | null; createdAt: string;
};

const columns: ColumnDef<WorkItem>[] = [
  { key: "title", header: "Title", render: (r) => r.title },
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "priority", header: "Priority", render: (r) => r.priority },
  { key: "assignee", header: "Assignee", render: (r) => r.assignee ?? "—" },
  { key: "dueAt", header: "Due", render: (r) => r.dueAt ?? "—" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function WorkItemsPanel() {
  return (
    <EntityPanel<WorkItem>
      title="Work Items"
      eyebrow="Case Management"
      fetchList={(qs) => api.listWorkItems(qs)}
      fetchOne={(id) => api.getWorkItem(id)}
      createEntity={(p) => api.createWorkItem(p as { caseId: string; title: string; priority: string; assignee?: string }) as unknown as Promise<{ [key: string]: WorkItem }>}
      updateEntity={(id, p) => api.updateWorkItem(id, p as { title?: string; status?: string; priority?: string; assignee?: string }) as unknown as Promise<{ [key: string]: WorkItem }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "title", label: "Title", required: true },
        { name: "priority", label: "Priority", required: true },
        { name: "assignee", label: "Assignee" },
      ]}
      filterPlaceholder="Search work items..."
    />
  );
}
