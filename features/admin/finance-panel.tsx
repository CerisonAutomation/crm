"use client";
/**
 * FinancePanel — admin management for invoicing and finance.
 * Lists all invoices with ability to send/pay/void.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner, StateBadge } from "@/components/brand/ui";
import { Eyebrow, SectionTitle } from "@/components/brand/ui";
import { useApiData, LoadingBlock, ErrorBlock } from "@/components/brand/data-state";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCcw, Trash2, Pencil, CheckCircle2, X, Euro, CreditCard, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

export type Invoice = {
  id: string;
  number: string;
  orgId: string;
  clientId: string;
  caseId: string | null;
  title: string;
  currency: string;
  amountCents: number;
  status: "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID" | "CREDITED";
  notes: string | null;
  lineItems: string | null; // JSON array
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  primaryBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  client?: {
    id: string;
    name: string;
  } | null;
};

export function FinancePanel() {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Invoice | null>(null);
  const [showEdit, setShowEdit] = useState<Invoice | null>(null);
  const [showDelete, setShowDelete] = useState<Invoice | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useApiData(() =>
    api.finance(),
  );

  const invoices: Invoice[] = data ? data.invoices ?? [] : [];

  const statusBadge = (status: Invoice["status"]) => {
    const config: Record<
      Invoice["status"],
      { variant: "default" | "destructive" | "secondary"; label: string }
    > = {
      DRAFT: { variant: "secondary", label: t("finance.status.draft") },
      SENT: { variant: "default", label: t("finance.status.sent") },
      PAID: { variant: "default", label: t("finance.status.paid") },
      OVERDUE: { variant: "destructive", label: t("finance.status.overdue") },
      VOID: { variant: "destructive", label: t("finance.status.void") },
      CREDITED: { variant: "default", label: t("finance.status.credited") },
    };
    return config[status];
  };

  const currencySymbol = (currency: string) => {
    const symbols: Record<string, string> = {
      CHF: "CHF",
      EUR: "€",
      USD: "$",
      GBP: "£",
    };
    return symbols[currency] || currency;
  };

  const handleCreate = async () => {
    // Note: Invoice creation is complex with line items, etc.
    // For now, we'll show a message that this should be done through the appropriate flow
    setShowCreate(false);
    toast({ title: t("finance.createViaFlow") });
  };

  const handlePay = async (id: string) => {
    setSubmitting(true);
    try {
      await api.post(`/api/finance/${id}`, { action: "pay" });
      toast({ title: t("finance.paid") });
      reload();
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : t("common.error"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (id: string) => {
    setSubmitting(true);
    try {
      await api.post(`/api/finance/${id}`, { action: "void" });
      toast({ title: t("finance.voided") });
      reload();
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : t("common.error"),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = (row: Invoice) => {
    setShowDetail(row);
  };

  const openEdit = (row: Invoice) => {
    // Edit functionality limited - mostly for notes
    editForm.notes = row.notes ?? "";
    setShowEdit(row);
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <PageShell>
      <AdminHeader
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
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead>{t("finance.column.number")}</TableHead>
              <TableHead>{t("finance.column.title")}</TableHead>
              <TableHead>{t("finance.column.amount")}</TableHead>
              <TableHead>{t("finance.column.currency")}</TableHead>
              <TableHead>{t("finance.column.status")}</TableHead>
              <TableHead className="w-24">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  {invoice.number}
                </TableCell>
                <TableCell>
                  {invoice.title}
                </TableCell>
                <TableCell>
                  {currencySymbol(invoice.currency)} {invoice.amountCents / 100}
                </TableCell>
                <TableCell>
                  {currencySymbol(invoice.currency)}
                </TableCell>
                <TableCell>
                  <StateBadge 
                    variant={statusBadge(invoice.status).variant}
                  >
                    {statusBadge(invoice.status).label}
                  </StateBadge>
                </TableCell>
                <TableCell className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDetail(invoice)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <div className="flex items-center gap-1">
                    {invoice.status === "SENT" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePay(invoice.id)}
                      >
                        {t("finance.pay")}
                      </Button>
                    )}
                    {(invoice.status === "PAID" || invoice.status === "SENT") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVoid(invoice.id)}
                      >
                        {t("finance.void")}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      
      {/* Detail dialog */}
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
                  {currencySymbol(showDetail.currency)} {showDetail.amountCents / 100}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.currency")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.currency}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.issuedAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.issuedAt ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.dueAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.dueAt ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.paidAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.paidAt ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.primaryBy")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.primaryBy ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.approvedBy")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.approvedBy ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("finance.detail.notes")}</Label>
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
      
      {/* Edit dialog */}
      {showEdit && (
        <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("finance.editTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("finance.edit.notes")}</Label>
                <Input
                  id="edit-notes"
                  placeholder={t("finance.edit.notesPlaceholder")}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEdit(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={async () => {
                setSubmitting(true);
                try {
                  await api.patch(`/api/finance/${showEdit!.id}`, { notes: editForm.notes });
                  toast({ title: t("common.saved") });
                  setShowEdit(null);
                  reload();
                } catch (e) {
                  toast({
                    title: e instanceof Error ? e.message : t("common.error"),
                    variant: "destructive",
                  });
                } finally {
                  setSubmitting(false);
                }
              }} disabled={submitting}>
                {submitting ? <Spinner className="h-4 w-4" /> : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}