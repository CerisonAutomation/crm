"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type VoiceCommand = {
  id: string; caseId: string; transcript: string; intent: string; confidence: number; createdAt: string;
};

const columns: ColumnDef<VoiceCommand>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "transcript", header: "Transcript", render: (r) => r.transcript },
  { key: "intent", header: "Intent", render: (r) => r.intent },
  { key: "confidence", header: "Confidence", render: (r) => `${(r.confidence * 100).toFixed(0)}%` },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function VoicePanel() {
  return (
    <EntityPanel<VoiceCommand>
      title="Voice Commands"
      eyebrow="Voice AI"
      fetchList={(qs) => api.listVoiceCommands(qs)}
      columns={columns}
      filterPlaceholder="Search voice commands..."
    />
  );
}