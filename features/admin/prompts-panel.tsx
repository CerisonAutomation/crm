"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Prompt = {
  id: string; key: string; name: string; version: number; active: boolean; createdAt: string;
};

const columns: ColumnDef<Prompt>[] = [
  { key: "key", header: "Key", render: (r) => r.key },
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "version", header: "Version", render: (r) => r.version },
  { key: "active", header: "Active", render: (r) => r.active ? "Yes" : "No" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function PromptsPanel() {
  return (
    <EntityPanel<Prompt>
      title="Prompts"
      eyebrow="AI Configuration"
      fetchList={(qs) => api.listPrompts(qs)}
      fetchOne={(id) => api.getPrompt(id)}
      createEntity={(p) => api.createPrompt(p as { key: string; name: string; content: string }) as unknown as Promise<{ [key: string]: Prompt }>}
      columns={columns}
      createFields={[
        { name: "key", label: "Key", required: true },
        { name: "name", label: "Name", required: true },
        { name: "content", label: "Content", required: true },
      ]}
      filterPlaceholder="Search prompts..."
    />
  );
}