"use client";
/**
 * FinancePanel — admin management for invoicing.
 * Lists the organisation's invoices with pay / void close-out actions.
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

type Invoice = {
  id: string;
  number: string;
  clientId: string;
  caseId: string | null;
  title: string;
  currency: string;
  amountCents: number;
  status: string;
  notes: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  primaryBy: string | null;
  approvedBy: string | null;
};

export function FinancePanel() {
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState<Invoice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiData(() => api.finance());
  const invoices: Invoice[] = data?.invoices ?? [];

  const statusLabel = (status: string) => {
    switch (status) {
      case "DRAFT":
        return t("finance.status.draft");
      case "SENT":
        return t("finance.status.sent");
      case "PAID":
        return t("finance.status.paid");
      case "OVERDUE":
        return t("finance.status.overdue");
      case "VOID":
        return t("finance.status.void");
      case "CREDITED":
        return t("finance.status.credited");
      default:
        return status;
    }
  };

  const money = (cents: number, currency: string) =>
    `${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`;

  const runAction = async (id: string, action: "PAY" | "VOID") => {
    setBusyId(id);
    try {
      await api.financeAction(id, action);
      toast({
        title: action === "PAY" ? t("finance.paid") : t("finance.voided"),
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
        eyebrow={t("admin.finance")}
        title={t("finance.title")}
        desc={t("finance.intro")}
      />

      {invoices.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("finance.emptyTitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("finance.emptyDescription")}
          </p>
        </Card>
      ) : (
        <Card className="gap-0 overflow-x-auto rounded-md border-border p-0">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>{t("finance.column.number")}</TableHead>
                <TableHead>{t("finance.column.title")}</TableHead>
                <TableHead>{t("finance.column.amount")}</TableHead>
                <TableHead>{t("finance.column.status")}</TableHead>
                <TableHead className="w-52 text-right">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const busy = busyId === invoice.id;
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      {invoice.number}
                    </TableCell>
                    <TableCell>{invoice.title}</TableCell>
                    <TableCell>
                      {money(invoice.amountCents, invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <StateBadge
                        state={invoice.status}
                        label={statusLabel(invoice.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowDetail(invoice)}
                          aria-label={t("finance.detailTitle")}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {invoice.status === "SENT" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void runAction(invoice.id, "PAY")}
                          >
                            {busy ? (
                              <Spinner className="h-3 w-3" />
                            ) : (
                              t("finance.pay")
                            )}
                          </Button>
                        )}
                        {(invoice.status === "PAID" ||
                          invoice.status === "SENT") && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void runAction(invoice.id, "VOID")}
                          >
                            {t("finance.void")}
                          </Button>
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
              <DialogTitle>{t("finance.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("finance.detail.number")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.number}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.title")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.title}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.amount")}</Label>
                <p className="text-sm text-cobble-ink">
                  {money(showDetail.amountCents, showDetail.currency)}
                </p>
              </div>
              {[
                { key: "issuedAt", label: t("finance.detail.issuedAt"), value: showDetail.issuedAt },
                { key: "dueAt", label: t("finance.detail.dueAt"), value: showDetail.dueAt },
                { key: "paidAt", label: t("finance.detail.paidAt"), value: showDetail.paidAt },
                { key: "primaryBy", label: t("finance.detail.primaryBy"), value: showDetail.primaryBy },
                { key: "approvedBy", label: t("finance.detail.approvedBy"), value: showDetail.approvedBy },
                { key: "notes", label: t("finance.detail.notes"), value: showDetail.notes },
              ].map((row) => (
                <div key={row.key} className="space-y-2">
                  <Label>{row.label}</Label>
                  <p className="text-sm text-muted-foreground">
                    {row.value ?? t("common.none")}
                  </p>
                </div>
              ))}
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
