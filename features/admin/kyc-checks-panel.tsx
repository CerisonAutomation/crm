"use client";
import { api } from "@/lib/api-client";
import { kycValidity } from "@/lib/domain/kyc-expiry";
import { EntityPanel, type ColumnDef } from "./entity-panel";

type KycCheck = {
  id: string;
  caseId: string;
  type: string;
  status: string;
  provider: string | null;
  createdAt: string;
  reviewedAt?: string | null;
};

/** A PASSED check past its derived validUntil reads REVIEW — re-validation due. */
function displayStatus(r: KycCheck): string {
  if (r.status === "PASSED" && r.reviewedAt) {
    try {
      if (
        kycValidity({
          checkType: r.type,
          status: r.status,
          reviewedAt: r.reviewedAt,
        }) === "EXPIRED"
      ) {
        return "REVIEW (expired)";
      }
    } catch {
      /* fall through to the stored status */
    }
  }
  return r.status;
}

const columns: ColumnDef<KycCheck>[] = [
  { key: "caseId", header: "Case", render: (r) => r.caseId },
  { key: "type", header: "Type", render: (r) => r.type },
  { key: "status", header: "Status", render: (r) => displayStatus(r) },
  { key: "provider", header: "Provider", render: (r) => r.provider ?? "—" },
  { key: "createdAt", header: "Created", render: (r) => r.createdAt },
];

export function KycChecksPanel() {
  return (
    <EntityPanel<KycCheck>
      title="KYC Checks"
      eyebrow="Compliance"
      fetchList={(qs) => api.listKycChecks(qs)}
      fetchOne={(id) => api.getKycCheck(id)}
      createEntity={(p) =>
        api.createKycCheck(
          p as { caseId: string; type: string; provider?: string }
        ) as unknown as Promise<{ [key: string]: KycCheck }>
      }
      updateEntity={(id, p) =>
        api.updateKycCheck(id, p as { status: string }) as unknown as Promise<{
          [key: string]: KycCheck;
        }>
      }
      columns={columns}
      createFields={[
        { name: "caseId", label: "Case ID", required: true },
        { name: "type", label: "Type", required: true },
        { name: "provider", label: "Provider" },
      ]}
      filterPlaceholder="Search KYC checks..."
    />
  );
}
