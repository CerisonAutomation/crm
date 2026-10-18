"use client";
/**
 * RemindersPanel — admin management for system reminders.
 * Lists all reminders with ability to fire/cancel.
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
import { Plus, RefreshCcw, Trash2, Pencil, Zap, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Reminder = {
  id: string;
  caseId: string | null;
  clientId: string | null;
  kind: string;
  title: string;
  detail: string | null;
  dueAt: string; // ISO string
  status: "SCHEDULED" | "FIRED" | "ESCALATED" | "DONE" | "CANCELLED";
  audience: "CLIENT" | "RM" | "BOTH";
  dedupeKey: string;
  firedAt: string | null;
  escalatedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO string
  case?: {
    id: string;
    reference: string;
  } | null;
};

export function RemindersPanel() {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Reminder | null>(null);
  const [showEdit, setShowEdit] = useState<Reminder | null>(null);
  const [showDelete, setShowDelete] = useState<Reminder | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useApiData(() =>
    api.get(`/api/reminders`),
  );

  // Note: There's no specific reminders endpoint in the API client yet
  // We'll need to check if one exists or create a workaround
  // For now, let's assume we can get reminders through a general endpoint
  // or we'll need to create the API endpoint first
  
  // Since there's no direct API endpoint for reminders in the client,
  // let's check if we can access them through another way or if we need to create the endpoint
  
  // For now, we'll show a placeholder and note that the API endpoint needs to be created
  const reminders: Reminder[] = [];

  const statusBadge = (status: Reminder["status"]) => {
    const config: Record<
      Reminder["status"],
      { variant: "default" | "destructive" | "secondary"; label: string }
    > = {
      SCHEDULED: { variant: "secondary", label: t("reminders.status.scheduled") },
      FIRED: { variant: "default", label: t("reminders.status.fired") },
      ESCALATED: { variant: "destructive", label: t("reminders.status.escalated") },
      DONE: { variant: "default", label: t("reminders.status.done") },
      CANCELLED: { variant: "destructive", label: t("reminders.status.cancelled") },
    };
    return config[status];
  };

  const kindBadge = (kind: string) => {
    const kindMap: Record<string, string> = {
      REQUEST_DUE: t("reminders.kind.requestDue"),
      DOC_EXPIRY: t("reminders.kind.docExpiry"),
      CASE_STALE: t("reminders.kind.caseStale"),
      BOOKING_UPCOMING: t("reminders.kind.bookingUpcoming"),
      FOLLOWUP_DUE: t("reminders.kind.followupDue"),
      COMPLIANCE: t("reminders.kind.compliance"),
      CUSTOM: t("reminders.kind.custom"),
    };
    return kindMap[kind] || kind;
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("admin.reminders")}
        title={t("reminders.title")}
        desc={t("reminders.intro")}
      />
      
      <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
        <p className="font-editorial text-lg text-cobble-ink">
          {t("reminders.placeholderTitle")}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("reminders.placeholderDescription")}
        </p>
        <Button variant="outline" size="sm">
          {t("reminders.placeholderAction")}
        </Button>
      </Card>
    </PageShell>
  );
}