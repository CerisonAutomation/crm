"use client";
/**
 * BookingsPanel — admin management for consultation bookings.
 * Lists the organisation's bookings with confirm / cancel / no-show actions.
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

type Booking = {
  id: string;
  startsAt: string;
  durationMin: number;
  status: string;
  clientName: string;
  clientEmail: string;
  caseId: string | null;
  channel: string;
  note: string | null;
  case: { id: string; reference: string } | null;
};

type BookingAction = "CONFIRM" | "CANCEL" | "NO_SHOW";

export function BookingsPanel() {
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState<Booking | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiData(() => api.bookings());
  const bookings: Booking[] = data?.bookings ?? [];

  const statusLabel = (status: string) => {
    switch (status) {
      case "REQUESTED":
        return t("bookings.status.requested");
      case "CONFIRMED":
        return t("bookings.status.confirmed");
      case "CANCELLED":
        return t("bookings.status.cancelled");
      case "COMPLETED":
        return t("bookings.status.completed");
      case "NO_SHOW":
        return t("bookings.status.noShow");
      default:
        return status;
    }
  };

  const runAction = async (id: string, action: BookingAction) => {
    setBusyId(id);
    try {
      await api.bookingAction(id, action);
      toast({
        title:
          action === "CONFIRM"
            ? t("bookings.confirmed")
            : action === "CANCEL"
              ? t("bookings.cancelled")
              : t("bookings.noShow"),
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
        <Card className="gap-0 overflow-x-auto rounded-md border-border p-0">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>{t("bookings.column.client")}</TableHead>
                <TableHead>{t("bookings.column.slot")}</TableHead>
                <TableHead>{t("bookings.column.status")}</TableHead>
                <TableHead>{t("bookings.column.case")}</TableHead>
                <TableHead className="w-56 text-right">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => {
                const busy = busyId === booking.id;
                return (
                  <TableRow key={booking.id}>
                    <TableCell>
                      <p className="font-medium text-cobble-ink">
                        {booking.clientName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {booking.clientEmail}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium text-cobble-ink">
                        {new Date(booking.startsAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {booking.durationMin} min
                      </p>
                    </TableCell>
                    <TableCell>
                      <StateBadge
                        state={booking.status}
                        label={statusLabel(booking.status)}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {booking.case?.reference ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowDetail(booking)}
                          aria-label={t("bookings.detailTitle")}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {booking.status === "REQUESTED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void runAction(booking.id, "CONFIRM")}
                          >
                            {busy ? (
                              <Spinner className="h-3 w-3" />
                            ) : (
                              t("bookings.confirm")
                            )}
                          </Button>
                        )}
                        {(booking.status === "REQUESTED" ||
                          booking.status === "CONFIRMED") && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void runAction(booking.id, "CANCEL")}
                          >
                            {t("bookings.cancel")}
                          </Button>
                        )}
                        {booking.status === "CONFIRMED" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void runAction(booking.id, "NO_SHOW")}
                          >
                            {t("bookings.noShow")}
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
              <DialogTitle>{t("bookings.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("bookings.detail.clientName")}</Label>
                <p className="text-sm text-cobble-ink">
                  {showDetail.clientName}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.clientEmail")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.clientEmail}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.slotTime")}</Label>
                <p className="text-sm text-cobble-ink">
                  {new Date(showDetail.startsAt).toLocaleString()}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.duration")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.durationMin} min
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.status")}</Label>
                <StateBadge
                  state={showDetail.status}
                  label={statusLabel(showDetail.status)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("bookings.detail.channel")}</Label>
                <p className="text-sm text-cobble-ink">
                  {showDetail.channel === "PORTAL"
                    ? t("bookings.channel.portal")
                    : t("bookings.channel.page")}
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
    </AdminPage>
  );
}
