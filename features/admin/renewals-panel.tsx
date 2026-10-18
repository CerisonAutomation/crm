"use client";
/**
 * RenewalsPanel — admin management for the obligation ledger.
 * Lists renewal reminders with complete / cancel close-out actions.
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
import { Spinner, StateBadge } from "@/components/brand/ui";
import { AdminPage, AdminPageHeader } from "@/components/brand/admin-surface";
import {
  useApiData,
  LoadingBlock,
  ErrorBlock,
} from "@/components/brand/data-state";
import { toast } from "@/hooks/use-toast";
import { Eye } from "lucide-react";

type RenewalReminder = {
  id: string;
  caseId: string | null;
  kind: string;
  title: string;
  notes: string | null;
  dueAt: string;
  remindAt: string | null;
  status: string;
  case: { reference: string } | null;
};

type RenewalStatus = "DONE" | "CANCELLED";

export function RenewalsPanel() {
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState<RenewalReminder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiData(() => api.renewals());
  const renewals: RenewalReminder[] = data?.renewals ?? [];

  const statusLabel = (status: string) => {
    switch (status) {
      case "OPEN":
        return t("renewals.status.open");
      case "SCHEDULED":
        return t("renewals.status.scheduled");
      case "DONE":
        return t("renewals.status.done");
      case "CANCELLED":
        return t("renewals.status.cancelled");
      default:
        return status;
    }
  };

  const kindLabel = (kind: string) => {
    switch (kind) {
      case "PERMIT_RENEWAL":
        return t("renewals.kind.permitRenewal");
      case "OBLIGATION":
        return t("renewals.kind.obligation");
      case "FILING_DEADLINE":
        return t("renewals.kind.filingDeadline");
      default:
        return kind;
    }
  };

  const updateStatus = async (id: string, status: RenewalStatus) => {
    setBusyId(id);
    try {
      await api.renewalUpdate(id, { status });
      toast({
        title:
          status === "DONE" ? t("renewals.done") : t("renewals.cancelled"),
      });
      await reload();
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : t("common.error"),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow={t("admin.renewals")}
        title={t("renewals.title")}
        desc={t("renewals.intro")}
      />

      {renewals.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("renewals.emptyTitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("renewals.emptyDescription")}
          </p>
        </Card>
      ) : (
        <Card className="gap-0 overflow-x-auto rounded-md border-border p-0">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>{t("renewals.column.title")}</TableHead>
                <TableHead>{t("renewals.column.kind")}</TableHead>
                <TableHead>{t("renewals.column.dueAt")}</TableHead>
                <TableHead>{t("renewals.column.remindAt")}</TableHead>
                <TableHead className="w-48 text-right">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renewals.map((renewal) => {
                const open =
                  renewal.status === "OPEN" || renewal.status === "SCHEDULED";
                const busy = busyId === renewal.id;
                return (
                  <TableRow key={renewal.id}>
                    <TableCell>
                      <p className="text-sm font-medium text-cobble-ink">
                        {renewal.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {renewal.case?.reference ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {kindLabel(renewal.kind)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(renewal.dueAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {renewal.remindAt
                        ? new Date(renewal.remindAt).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <StateBadge
                          state={renewal.status}
                          label={statusLabel(renewal.status)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowDetail(renewal)}
                          aria-label={t("renewals.detailTitle")}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {open && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void updateStatus(renewal.id, "DONE")
                              }
                            >
                              {busy ? (
                                <Spinner className="h-3 w-3" />
                              ) : (
                                t("renewals.done")
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void updateStatus(renewal.id, "CANCELLED")
                              }
                            >
                              {t("renewals.cancel")}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("renewals.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("renewals.detail.title")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.title}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.kind")}</Label>
                <p className="text-sm text-muted-foreground">
                  {kindLabel(showDetail.kind)}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.dueAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {new Date(showDetail.dueAt).toLocaleDateString()}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.remindAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.remindAt
                    ? new Date(showDetail.remindAt).toLocaleDateString()
                    : t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.notes")}</Label>
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
