"use client";
/**
 * RemindersPanel — the deadline ledger.
 * Lists reminders and lets an operator run the sweeper (fire due / escalate).
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
import { RefreshCcw } from "lucide-react";

type Reminder = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  dueAt: string;
  status: string;
  audience: string;
  case: { id: string; reference: string } | null;
};

export function RemindersPanel() {
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState<Reminder | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const { data, loading, error, reload } = useApiData(() => api.reminders());
  const reminders: Reminder[] = data?.reminders ?? [];

  const statusLabel = (status: string) => {
    switch (status) {
      case "SCHEDULED":
        return t("reminders.status.scheduled");
      case "FIRED":
        return t("reminders.status.fired");
      case "ESCALATED":
        return t("reminders.status.escalated");
      case "DONE":
        return t("reminders.status.done");
      case "CANCELLED":
        return t("reminders.status.cancelled");
      default:
        return status;
    }
  };

  const kindLabel = (kind: string) => {
    switch (kind) {
      case "REQUEST_DUE":
        return t("reminders.kind.requestDue");
      case "DOC_EXPIRY":
        return t("reminders.kind.docExpiry");
      case "CASE_STALE":
        return t("reminders.kind.caseStale");
      case "BOOKING_UPCOMING":
        return t("reminders.kind.bookingUpcoming");
      case "FOLLOWUP_DUE":
        return t("reminders.kind.followupDue");
      case "COMPLIANCE":
        return t("reminders.kind.compliance");
      case "CUSTOM":
        return t("reminders.kind.custom");
      default:
        return kind;
    }
  };

  const sweep = async () => {
    setSweeping(true);
    try {
      const res = await api.reminderSweep();
      toast({
        title: `${res.swept.fired} fired · ${res.swept.escalated} escalated`,
      });
      await reload();
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : t("common.error"),
        variant: "destructive",
      });
    } finally {
      setSweeping(false);
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow={t("admin.reminders")}
        title={t("reminders.title")}
        desc={t("reminders.intro")}
        actions={
          <Button variant="outline" size="sm" onClick={sweep} disabled={sweeping}>
            {sweeping ? (
              <Spinner className="mr-2 h-3.5 w-3.5" />
            ) : (
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            )}
            {t("reminders.sweep")}
          </Button>
        }
      />

      {reminders.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("reminders.placeholderTitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("reminders.placeholderDescription")}
          </p>
        </Card>
      ) : (
        <Card className="gap-0 overflow-x-auto rounded-md border-border p-0">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.description")}</TableHead>
                <TableHead>{t("reminders.column.due")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-20 text-right">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reminders.map((reminder) => (
                <TableRow key={reminder.id}>
                  <TableCell>
                    <p className="text-sm font-medium text-cobble-ink">
                      {reminder.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {kindLabel(reminder.kind)}
                      {reminder.case
                        ? ` · ${reminder.case.reference}`
                        : undefined}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                    {reminder.detail ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(reminder.dueAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <StateBadge
                      state={reminder.status}
                      label={statusLabel(reminder.status)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDetail(reminder)}
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
              <DialogTitle>{t("reminders.detailTitle")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm font-medium text-cobble-ink">
              {showDetail.title}
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("common.description")}</Label>
                <p className="text-sm text-muted-foreground">
                  {showDetail.detail ?? t("common.none")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("common.date")}</Label>
                <p className="text-sm text-cobble-ink">
                  {new Date(showDetail.dueAt).toLocaleString()}
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
                <Label>{t("reminders.detail.kind")}</Label>
                <p className="text-sm text-muted-foreground">
                  {kindLabel(showDetail.kind)}
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
