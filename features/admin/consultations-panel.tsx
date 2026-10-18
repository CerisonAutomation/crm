"use client";
/**
 * ConsultationsPanel — admin view of scheduled consultations.
 * Read-only ledger with a detail dialog (confirm/cancel happens on bookings).
 */
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StateBadge } from "@/components/brand/ui";
import { AdminPage, AdminPageHeader } from "@/components/brand/admin-surface";
import {
  useApiData,
  LoadingBlock,
  ErrorBlock,
} from "@/components/brand/data-state";

type Consultation = {
  id: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string | null;
  programmeKey: string | null;
  scheduledAt: string;
  durationMin: number;
  status: string;
  icsSentAt: string | null;
  notes: string | null;
};

export function ConsultationsPanel() {
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState<Consultation | null>(null);

  const { data, loading, error, reload } = useApiData(() =>
    api.consultations(),
  );
  const consultations: Consultation[] = data?.consultations ?? [];

  const statusLabel = (status: string) => {
    switch (status) {
      case "REQUESTED":
        return t("consultations.status.requested");
      case "CONFIRMED":
        return t("consultations.status.confirmed");
      case "COMPLETED":
        return t("consultations.status.completed");
      case "CANCELLED":
        return t("consultations.status.cancelled");
      default:
        return status;
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow={t("admin.consultations")}
        title={t("consultations.title")}
        desc={t("consultations.intro")}
      />

      {consultations.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("consultations.placeholderTitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("consultations.placeholderDescription")}
          </p>
        </Card>
      ) : (
        <Card className="gap-0 overflow-x-auto rounded-md border-border p-0">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>{t("consultations.column.lead")}</TableHead>
                <TableHead>{t("common.email")}</TableHead>
                <TableHead>{t("consultations.column.scheduled")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-20 text-right">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consultations.map((consultation) => (
                <TableRow key={consultation.id}>
                  <TableCell className="text-sm font-medium text-cobble-ink">
                    {consultation.leadName}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {consultation.leadEmail}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(consultation.scheduledAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <StateBadge
                      state={consultation.status}
                      label={statusLabel(consultation.status)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDetail(consultation)}
                    >
                      {t("common.details")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("consultations.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("common.name")}</Label>
                <p className="text-sm text-cobble-ink">
                  {showDetail.leadName}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("common.email")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.leadEmail}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("common.phone")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.leadPhone ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("consultations.column.scheduled")}</Label>
                <p className="text-sm text-cobble-ink">
                  {new Date(showDetail.scheduledAt).toLocaleString()} ·{" "}
                  {showDetail.durationMin} min
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("common.status")}</Label>
                <StateBadge
                  state={showDetail.status}
                  label={statusLabel(showDetail.status)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("common.description")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.notes ?? t("common.none")}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetail(null)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AdminPage>
  );
}
