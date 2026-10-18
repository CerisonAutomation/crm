"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type McpTool = {
  id: string; name: string; description: string; inputSchema: Record<string, unknown>;
};

const columns: ColumnDef<McpTool>[] = [
  { key: "name", header: "Name", render: (r) => r.name },
  { key: "description", header: "Description", render: (r) => r.description },
];

export function McpPanel() {
  return (
    <EntityPanel<McpTool>
      title="MCP Tools"
      eyebrow="Integrations"
      fetchList={() => api.listMcpTools() as unknown as Promise<{ [key: string]: McpTool[] }>}
      columns={columns}
      filterPlaceholder="Search MCP tools..."
    />
  );
}