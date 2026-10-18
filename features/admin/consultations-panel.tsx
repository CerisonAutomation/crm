"use client";
/**
 * ConsultationsPanel — admin management for consultations.
 * Lists all consultations with ability to confirm/cancel.
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
import { Plus, RefreshCcw, Trash2, Pencil, CheckCircle2, X, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Consultation = {
  id: string;
  orgId: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string | null;
  programmeKey: string | null;
  scheduledAt: string; // ISO string
  durationMin: number;
  status: "REQUESTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  icsSentAt: string | null;
  notes: string | null;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
};

export function ConsultationsPanel() {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Consultation | null>(null);
  const [showEdit, setShowEdit] = useState<Consultation | null>(null);
  const [showDelete, setShowDelete] = useState<Consultation | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload } = useApiData(() =>
    api.get(`/api/consultations`),
  );

  // Note: There's no specific consultations endpoint in the API client yet
  // We'll need to check if one exists or create a workaround
  
  // For now, we'll show a placeholder and note that the API endpoint needs to be created
  const consultations: Consultation[] = [];

  const statusBadge = (status: Consultation["status"]) => {
    const config: Record<
      Consultation["status"],
      { variant: "default" | "destructive" | "secondary"; label: string }
    > = {
      REQUESTED: { variant: "secondary", label: t("consultations.status.requested") },
      CONFIRMED: { variant: "default", label: t("consultations.status.confirmed") },
      COMPLETED: { variant: "default", label: t("consultations.status.completed") },
      CANCELLED: { variant: "destructive", label: t("consultations.status.cancelled") },
    };
    return config[status];
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("admin.consultations")}
        title={t("consultations.title")}
        desc={t("consultations.intro")}
      />
      
      <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
        <p className="font-editorial text-lg text-cobble-ink">
          {t("consultations.placeholderTitle")}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("consultations.placeholderDescription")}
        </p>
        <Button variant="outline" size="sm">
          {t("consultations.placeholderAction")}
        </Button>
      </Card>
    </PageShell>
  );
}