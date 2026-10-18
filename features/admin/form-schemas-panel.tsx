"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type FormSchema = {
  id: string; key: string; name: string; version: number; active: boolean; createdAt: string;
};

const columns: ColumnDef<FormSchema>[] = [
  { key: "key", header: "Key", render: (r) => r.key },
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "version", header: "Version", render: (r) => r.version },
  { key: "active", header: "Active", render: (r) => r.active ? "Yes" : "No" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function FormSchemasPanel() {
  return (
    <EntityPanel<FormSchema>
      title="Form Schemas"
      eyebrow="Configuration"
      fetchList={(qs) => api.listFormSchemas(qs)}
      fetchOne={(id) => api.getFormSchema(id)}
      createEntity={(p) => api.createFormSchema(p as { key: string; name: string; schema: Record<string, unknown> }) as unknown as Promise<{ [key: string]: FormSchema }>}
      updateEntity={(id, p) => api.updateFormSchema(id, p as { name?: string; schema?: Record<string, unknown>; active?: boolean }) as unknown as Promise<{ [key: string]: FormSchema }>}
      columns={columns}
      createFields={[
        { name: "key", label: "Key", required: true },
        { name: "name", label: "Name", required: true },
        { name: "schema", label: "Schema (JSON)", required: true },
      ]}
      filterPlaceholder="Search form schemas..."
    />
  );
}