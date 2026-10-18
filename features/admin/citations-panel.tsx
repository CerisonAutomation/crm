"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Citation = {
  id: string; caseId: string; source: string; title: string; url: string | null; relevance: number; createdAt: string;
};

const columns: ColumnDef<Citation>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "source", header: "Source", render: (r) => r.source },
  { key: "title", header: "Title", render: (r) => r.title },
  { key: "url", header: "URL", render: (r) => r.url ?? "—" },
  { key: "relevance", header: "Relevance", render: (r) => `${(r.relevance * 100).toFixed(0)}%` },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function CitationsPanel() {
  return (
    <EntityPanel<Citation>
      title="Citations"
      eyebrow="Research"
      fetchList={(qs) => api.listCitations(qs)}
      createEntity={(p) => api.createCitation(p as { caseId: string; source: string; title: string; url?: string; relevance: number }) as unknown as Promise<{ [key: string]: Citation }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "source", label: "Source", required: true },
        { name: "title", label: "Title", required: true },
        { name: "url", label: "URL" },
        { name: "relevance", label: "Relevance", type: "number", required: true },
      ]}
      filterPlaceholder="Search citations..."
    />
  );
}
