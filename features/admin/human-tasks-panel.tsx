"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type HumanTask = {
  id: string; caseId: string; title: string; status: string; priority: string;
  assignee: string | null; dueAt: string | null; createdAt: string;
};

const columns: ColumnDef<HumanTask>[] = [
  { key: "title", header: "Title", render: (r) => r.title },
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "status", header: "Status", render: (r) => r.status },
  { key: "priority", header: "Priority", render: (r) => r.priority },
  { key: "assignee", header: "Assignee", render: (r) => r.assignee ?? "—" },
  { key: "dueAt", header: "Due", render: (r) => r.dueAt ?? "—" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function HumanTasksPanel() {
  return (
    <EntityPanel<HumanTask>
      title="Human Tasks"
      eyebrow="Case Management"
      fetchList={(qs) => api.listHumanTasks(qs)}
      fetchOne={(id) => api.getHumanTask(id)}
      createEntity={(p) => api.createHumanTask(p as { caseId: string; title: string; priority: string; assignee?: string; dueAt?: string }) as unknown as Promise<{ [key: string]: HumanTask }>}
      updateEntity={(id, p) => api.updateHumanTask(id, p as { title?: string; status?: string; priority?: string; assignee?: string; dueAt?: string }) as unknown as Promise<{ [key: string]: HumanTask }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "title", label: "Title", required: true },
        { name: "priority", label: "Priority", required: true },
        { name: "assignee", label: "Assignee" },
        { name: "dueAt", label: "Due Date" },
      ]}
      filterPlaceholder="Search human tasks..."
    />
  );
}
