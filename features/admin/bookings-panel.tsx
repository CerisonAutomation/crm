"use client";
/**
 * BookingsPanel — admin management for consultation bookings.
 * Lists all bookings with ability to confirm/cancel/no-show.
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
import { Plus, RefreshCcw, Trash2, Pencil, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Booking = {
  id: string;
  slotId: string;
  startsAt: string; // ISO string
  durationMin: number;
  status: "REQUESTED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  cancelReason: string | null;
  clientName: string;
  clientEmail: string;
  clientId: string | null;
  caseId: string | null;
  channel: "PORTAL" | "PAGE";
  note: string | null;
  createdAt: string; // ISO string
  case?: {
    id: string;
    reference: string;
  } | null;
};

export function BookingsPanel() {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Booking | null>(null);
  const [showEdit, setShowEdit] = useState<Booking | null>(null);
  const [showDelete, setShowDelete] = useState<Booking | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useApiData(() =>
    api.bookings(),
  );

  // Re-fetch when a booking is created/updated/deleted
  // (handled by the individual mutation functions calling reload)

  const bookings: Booking[] = data ? data.bookings ?? [] : [];

  const statusBadge = (status: Booking["status"]) => {
    const config: Record<
      Booking["status"],
      { variant: "default" | "destructive" | "secondary"; label: string }
    > = {
      REQUESTED: { variant: "secondary", label: t("bookings.status.requested") },
      CONFIRMED: { variant: "default", label: t("bookings.status.confirmed") },
      CANCELLED: { variant: "destructive", label: t("bookings.status.cancelled") },
      COMPLETED: { variant: "default", label: t("bookings.status.completed") },
      NO_SHOW: { variant: "destructive", label: t("bookings.status.noShow") },
    };
    return config[status];
  };

  const handleCreate = async () => {
    // Note: Booking creation is typically done through the public interface
    // Admin mostly manages existing bookings (confirm/cancel/etc.)
    // So we don't implement create here - bookings are made by clients
    setShowCreate(false);
    toast({ title: t("bookings.createViaClient") });
  };

  const handleConfirm = async (id: string) => {
    setSubmitting(true);
    try {
      await api.post(`/api/bookings/${id}`, { action: "confirm" });
      toast({ title: t("bookings.confirmed") });
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
      await api.post(`/api/bookings/${id}`, { action: "cancel" });
      toast({ title: t("bookings.cancelled") });
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

  const handleNoShow = async (id: string) => {
    setSubmitting(true);
    try {
      await api.post(`/api/bookings/${id}`, { action: "no-show" });
      toast({ title: t("bookings.noShow") });
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

  const openDetail = (row: Booking) => {
    setShowDetail(row);
  };

  const openEdit = (row: Booking) => {
    // Edit functionality limited - mostly for notes
    editForm.note = row.note ?? "";
    setShowEdit(row);
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("admin.bookings")}
        title={t("bookings.title")}
        desc={t("bookings.intro")}
      />
      
      {bookings.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("bookings.emptyTitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("bookings.emptyDescription")}
          </p>
        </Card>
      ) : (
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead>{t("bookings.column.client")}</TableHead>
              <TableHead>{t("bookings.column.slot")}</TableHead>
              <TableHead>{t("bookings.column.status")}</TableHead>
              <TableHead>{t("bookings.column.case")}</TableHead>
              <TableHead className="w-24">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((booking) => (
              <TableRow key={booking.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {/* Client info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-cobble-ink">{booking.clientName}</p>
                      <p className="text-xs text-muted-foreground">
                        {booking.clientEmail}
                      </p>
                      {booking.caseId && (
                        <p className="text-xs text-muted-foreground">
                          Case: {booking.case?.reference}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {/* Slot info */}
                    <div>
                      <p className="text-sm font-medium text-cobble-ink">
                        {new Date(booking.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {booking.durationMin} min
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <StateBadge 
                    variant={statusBadge(booking.status).variant}
                  >
                    {statusBadge(booking.status).label}
                  </StateBadge>
                </TableCell>
                <TableCell>
                  {/* Case info */}
                  {booking.caseId ? (
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-cobble-ink">
                        {booking.case?.reference ?? "—"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </TableCell>
                <TableCell className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openDetail(booking)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <div className="flex items-center gap-1">
                    {booking.status === "REQUESTED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConfirm(booking.id)}
                      >
                        {t("bookings.confirm")}
                      </Button>
                    )}
                    {(booking.status === "CONFIRMED" || booking.status === "REQUESTED") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCancel(booking.id)}
                      >
                        {t("bookings.cancel")}
                      </Button>
                    )}
                    {booking.status === "CONFIRMED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleNoShow(booking.id)}
                      >
                        {t("bookings.noShow")}
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
              <DialogTitle>{t("bookings.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("bookings.detail.clientName")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.clientName}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.clientEmail")}</Label>
                <p className="text-sm text-muted-foreground">{showDetail.clientEmail}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.slotTime")}</Label>
                <p className="text-sm text-cobble-ink">
                  {new Date(showDetail.startsAt).toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.duration")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.durationMin} minutes
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.status")}</Label>
                <StateBadge 
                  variant={statusBadge(showDetail.status).variant}
                >
                  {statusBadge(showDetail.status).label}
                </StateBadge>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.channel")}</Label>
                <p className="text-sm text-cobble-ink">
                  {showDetail.channel === "PORTAL" ? t("bookings.channel.portal") : t("bookings.channel.page")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.note")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.note ?? t("bookings.detail.noteNone")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.case")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.case?.reference ?? t("bookings.detail.caseNone")}
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
              <DialogTitle>{t("bookings.editTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("bookings.edit.note")}</Label>
                <Input
                  id="edit-note"
                  placeholder={t("bookings.edit.notePlaceholder")}
                  value={editForm.note}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, note: e.target.value }))}
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
                  await api.patch(`/api/bookings/${showEdit!.id}`, { note: editForm.note });
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