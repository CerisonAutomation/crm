"use client";
import { api } from "@/lib/api-client";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type BusinessSetting = {
  id: string; key: string; value: string; updatedAt: string;
};

const columns: ColumnDef<BusinessSetting>[] = [
  { key: "key", header: "Key", render: (r) => r.key },
  { key: "value", header: "Value", render: (r) => r.value },
  { key: "updatedAt", header: "Updated", render: (r) => r.updatedAt },
];

export function BusinessSettingsPanel() {
  return (
    <EntityPanel<BusinessSetting>
      title="Business Settings"
      eyebrow="Configuration"
      fetchList={() => api.listBusinessSettings() as unknown as Promise<{ [key: string]: BusinessSetting[] }>}
      fetchOne={(key) => api.getBusinessSetting(key) as unknown as Promise<{ [key: string]: BusinessSetting }>}
      updateEntity={(key, p) => api.updateBusinessSetting(key, p as { value: string }) as unknown as Promise<{ [key: string]: BusinessSetting }>}
      columns={columns}
      filterPlaceholder="Search settings..."
    />
  );
}