"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type Availability = {
  id: string; userId: string; dayOfWeek: number; startTime: string; endTime: string; createdAt: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const columns: ColumnDef<Availability>[] = [
  { key: "userId", header: "User", render: (r) => r.userId },
  { key: "dayOfWeek", header: "Day", render: (r) => DAY_NAMES[r.dayOfWeek] ?? String(r.dayOfWeek) },
  { key: "startTime", header: "Start", render: (r) => r.startTime },
  { key: "endTime", header: "End", render: (r) => r.endTime },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function AvailabilityPanel() {
  return (
    <EntityPanel<Availability>
      title="Availability"
      eyebrow="Scheduling"
      fetchList={(qs) => api.listAvailability(qs)}
      fetchOne={(id) => api.getAvailability(id)}
      createEntity={(p) => api.createAvailability(p as { userId: string; dayOfWeek: number; startTime: string; endTime: string }) as unknown as Promise<{ [key: string]: Availability }>}
      columns={columns}
      createFields={[
        { name: "userId", label: "User ID", required: true },
        { name: "dayOfWeek", label: "Day of Week (0-6)", type: "number", required: true },
        { name: "startTime", label: "Start Time", required: true },
        { name: "endTime", label: "End Time", required: true },
      ]}
      filterPlaceholder="Search availability..."
    />
  );
}