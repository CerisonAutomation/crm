"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Attachment = {
  id: string; caseId: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string;
};

const columns: ColumnDef<Attachment>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "fileName", header: "File Name", render: (r) => r.fileName },
  { key: "mimeType", header: "MIME Type", render: (r) => r.mimeType },
  { key: "sizeBytes", header: "Size", render: (r) => `${(r.sizeBytes / 1024).toFixed(1)} KB` },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function AttachmentsPanel() {
  return (
    <EntityPanel<Attachment>
      title="Attachments"
      eyebrow="Documents"
      fetchList={(qs) => api.listAttachments(qs)}
      fetchOne={(id) => api.getAttachment(id)}
      createEntity={(p) => api.createAttachment(p as { caseId: string; fileName: string; mimeType: string; sizeBytes: number }) as unknown as Promise<{ [key: string]: Attachment }>}
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "fileName", label: "File Name", required: true },
        { name: "mimeType", label: "MIME Type", required: true },
        { name: "sizeBytes", label: "Size (bytes)", type: "number", required: true },
      ]}
      filterPlaceholder="Search attachments..."
    />
  );
}