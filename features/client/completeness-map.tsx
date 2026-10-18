"use client";

/**
 * CompletenessMap — visual representation of application completeness.
 *
 * Shows a grid of required documents with their status (uploaded, pending,
 * rejected, changes requested) and an overall completeness score.
 */

import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, Clock, X, AlertCircle, FileText, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export type DocumentStatus =
  | "RM_APPROVED"
  | "CLIENT_CONFIRMED"
  | "IN_REVIEW"
  | "UPLOADED"
  | "OCR_PROCESSING"
  | "OCR_PROCESSED"
  | "CHANGES_REQUESTED"
  | "RM_REJECTED"
  | "PENDING";

type DocumentItem = {
  type: string;
  title: string;
  status: DocumentStatus;
  required: boolean;
};

type CompletenessMapProps = {
  documents: DocumentItem[];
  overallPercentage: number;
  className?: string;
};

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; icon: typeof Check; color: string; bgColor: string }
> = {
  RM_APPROVED: {
    label: "Approved",
    icon: Check,
    color: "text-olive-ink",
    bgColor: "bg-olive/10 border-olive/30",
  },
  CLIENT_CONFIRMED: {
    label: "Confirmed",
    icon: Check,
    color: "text-olive-ink",
    bgColor: "bg-olive/10 border-olive/30",
  },
  IN_REVIEW: {
    label: "In Review",
    icon: Clock,
    color: "text-amber-ink",
    bgColor: "bg-amber/10 border-amber/30",
  },
  UPLOADED: {
    label: "Uploaded",
    icon: Upload,
    color: "text-sky-ink",
    bgColor: "bg-sky/10 border-sky/30",
  },
  OCR_PROCESSING: {
    label: "Processing",
    icon: Clock,
    color: "text-sky-ink",
    bgColor: "bg-sky/10 border-sky/30",
  },
  OCR_PROCESSED: {
    label: "Ready",
    icon: FileText,
    color: "text-sky-ink",
    bgColor: "bg-sky/10 border-sky/30",
  },
  CHANGES_REQUESTED: {
    label: "Changes Needed",
    icon: AlertCircle,
    color: "text-coral",
    bgColor: "bg-coral/10 border-coral/30",
  },
  RM_REJECTED: {
    label: "Rejected",
    icon: X,
    color: "text-coral",
    bgColor: "bg-coral/10 border-coral/30",
  },
  PENDING: {
    label: "Pending",
    icon: Clock,
    color: "text-muted-foreground",
    bgColor: "bg-muted/10 border-border",
  },
};

export function CompletenessMap({
  documents,
  overallPercentage,
  className,
}: CompletenessMapProps) {
  const { t } = useI18n();

  const requiredDocs = documents.filter((d) => d.required);
  const completedDocs = requiredDocs.filter((d) =>
    ["RM_APPROVED", "CLIENT_CONFIRMED", "IN_REVIEW"].includes(d.status)
  );
  const pendingDocs = requiredDocs.filter((d) => d.status === "PENDING");
  const changesRequestedDocs = requiredDocs.filter(
    (d) => d.status === "CHANGES_REQUESTED"
  );
  const rejectedDocs = requiredDocs.filter((d) => d.status === "RM_REJECTED");

  const getStatusConfig = (status: DocumentStatus) => {
    return STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{t("clx.yourDocuments")}</CardTitle>
          <Badge variant="outline" className="text-sm font-semibold">
            {overallPercentage}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall progress */}
        <div className="space-y-2">
          <Progress value={overallPercentage} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {completedDocs.length}/{requiredDocs.length}{" "}
              {t("clx.fulfilledLabel")}
            </span>
            {pendingDocs.length > 0 && (
              <span className="text-amber-ink">
                {pendingDocs.length} pending
              </span>
            )}
          </div>
        </div>

        {/* Status summary */}
        <div className="flex flex-wrap gap-3 text-xs">
          {completedDocs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-olive" />
              <span className="text-muted-foreground">
                {completedDocs.length} approved
              </span>
            </div>
          )}
          {pendingDocs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-amber" />
              <span className="text-muted-foreground">
                {pendingDocs.length} pending
              </span>
            </div>
          )}
          {changesRequestedDocs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-coral" />
              <span className="text-muted-foreground">
                {changesRequestedDocs.length} changes requested
              </span>
            </div>
          )}
          {rejectedDocs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-coral" />
              <span className="text-muted-foreground">
                {rejectedDocs.length} rejected
              </span>
            </div>
          )}
        </div>

        {/* Document list */}
        <div className="space-y-2">
          {documents.map((doc) => {
            const config = getStatusConfig(doc.status);
            const Icon = config.icon;
            return (
              <button
                key={doc.type}
                type="button"
                onClick={() => {
                  document
                    .getElementById(`doc-card-${doc.type}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                aria-label={`${doc.title} — show document`}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors hover:border-gold/40",
                  config.bgColor
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn("h-4 w-4", config.color)} />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {doc.title}
                    </p>
                    {doc.required && (
                      <p className="text-xs text-muted-foreground">
                        {t("common.required")}
                      </p>
                    )}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("text-xs", config.color)}
                >
                  {config.label}
                </Badge>
              </button>
            );
          })}
        </div>

        {/* Empty state */}
        {documents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t("clx.emptyDocs")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
