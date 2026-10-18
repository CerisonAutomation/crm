"use client";
/**
 * RenewalsPanel — admin management for renewal reminders.
 * Lists all renewal reminders with ability to mark as done/cancel.
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
import { Plus, RefreshCcw, Trash2, Pencil, CheckCircle2, X, Clock, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export type RenewalReminder = {
  id: string;
  orgId: string;
  caseId: string | null;
  clientId: string;
  kind: string;
  title: string;
  notes: string | null;
  dueAt: string; // ISO string
  remindAt: string | null;
  status: "OPEN" | "SCHEDULED" | "DONE" | "CANCELLED";
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  case?: {
    id: string;
    reference: string;
  } | null;
};

export function RenewalsPanel() {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<RenewalReminder | null>(null);
  const [showEdit, setShowEdit] = useState<RenewalReminder | null>(null);
  const [showDelete, setShowDelete] = useState<RenewalReminder | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useApiData(() =>
    api.renewals(),
  );

  const renewals: RenewalReminder[] = data ? data.renewals ?? [] : [];

  const statusBadge = (status: RenewalReminder["status"]) => {
    const config: Record<
      RenewalReminder["status"],
      { variant: "default" | "destructive" | "secondary"; label: string }
    > = {
      OPEN: { variant: "secondary", label: t("renewals.status.open") },
      SCHEDULED: { variant: "default", label: t("renewals.status.scheduled") },
      DONE: { variant: "default", label: t("renewals.status.done") },
      CANCELLED: { variant: "destructive", label: t("renewals.status.cancelled") },
    };
    return config[status];
  };

  const kindBadge = (kind: string) => {
    const kindMap: Record<string, string> = {
      PERMIT_RENEWAL: t("renewals.kind.permitRenewal"),
      OBLIGATION: t("renewals.kind.obligation"),
      FILING_DEADLINE: t("renewals.kind.filingDeadline"),
    };
    return kindMap[kind] || kind;
  };

  const handleCreate = async () => {
    // Note: Renewal creation is typically done through case workflows
    // For now, we'll show a message that this should be done through the appropriate flow
    setShowCreate(false);
    toast({ title: t("renewals.createViaFlow") });
  };

  const handleMarkAsDone = async (id: string) => {
    setSubmitting(true);
    try {
      await api.post(`/api/renewals/${id}`, { action: "done" });
      toast({ title: t("renewals.done") });
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

  const handleCancel = async (id: string) => {
    setSubmitting(true);
    try {
      await api.post(`/api/renewals/${id}`, { action: "cancel" });
      toast({ title: t("renewals.cancelled") });
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

  const openDetail = (row: RenewalReminder) => {
    setShowDetail(row);
  };

  const openEdit = (row: RenewalReminder) => {
    // Edit functionality limited - mostly for notes
    editForm.notes = row.notes ?? "";
    setShowEdit(row);
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <PageShell>
      <AdminHeader
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
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead>{t("renewals.column.title")}</TableHead>
              <TableHead>{t("renewals.column.kind")}</TableHead>
              <TableHead>{t("renewals.column.dueAt")}</TableHead>
              <TableHead>{t("renewals.column.remindAt")}</TableHead>
              <TableHead className="w-24">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {renewals.map((renewal) => (
              <TableRow key={renewal.id}>
                <TableCell>
                  {renewal.title}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-cobble-ink">
                    {kindBadge(renewal.kind)}
                  </span>
                </TableCell>
                <TableCell>
                  {renewal.dueAt ? (
                    <p className="text-sm text-muted-foreground">
                      {new Date(renewal.dueAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </TableCell>
                <TableCell>
                  {renewal.remindAt ? (
                    <p className="text-sm text-muted-foreground">
                      {new Date(renewal.remindAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </TableCell>
                <TableCell className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDetail(renewal)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <div className="flex items-center gap-1">
                    {renewal.status === "OPEN" || renewal.status === "SCHEDULED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkAsDone(renewal.id)}
                      >
                        {t("renewals.done")}
                      </Button>
                    )}
                    {renewal.status === "OPEN" || renewal.status === "SCHEDULED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCancel(renewal.id)}
                      >
                        {t("renewals.cancel")}
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
              <DialogTitle>{t("renewals.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("renewals.detail.title")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.title}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.kind")}</Label>
                <p className="text-sm text-cobble-ink">{kindBadge(showDetail.kind)}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.dueAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.dueAt ? (
                    <p className="text-sm text-muted-foreground">
                      {new Date(showDetail.dueAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("renewals.detail.remindAt")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.remindAt ? (
                    <p className="text-sm text-muted-foreground">
                      {new Date(showDetail.remindAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
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
      
      {/* Edit dialog */}
      {showEdit && (
        <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("renewals.editTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("renewals.edit.notes")}</Label>
                <Input
                  id="edit-notes"
                  placeholder={t("renewals.edit.notesPlaceholder")}
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
                  await api.patch(`/api/renewals/${showEdit!.id}`, { notes: editForm.notes });
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