"use client";

/**
 * JourneyBar — visual progress indicator for the client's application journey.
 *
 * Shows a horizontal progress bar with stage markers, completion percentage,
 * and next steps. Uses the case-progress domain logic for accurate scoring.
 */

import { useI18n } from "@/lib/i18n";
import {
  computeCaseProgress,
  type ProgressCaseInput,
} from "@/lib/domain/case-progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, FileText, Upload, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type JourneyBarProps = {
  caseData: ProgressCaseInput;
  className?: string;
  /** Dead-UI wiring: completed/current stages become buttons that jump
      somewhere real (e.g. timeline, requests). Absent = display only. */
  onStageClick?: (index: number) => void;
  /**
   * E7 events feed: when supplied, the bar renders the latest recorded events
   * beneath the stepper so the journey reflects what actually happened, not a
   * parallel static track. RFI QUESTION/ANSWER/SYSTEM turns arrive here via
   * `rfiThreadsToJourneyEvents`; NOTE turns are staff-only and filtered both
   * upstream and here (defence in depth — this bar is client-visible).
   */
  events?: Array<{
    title: string;
    timestamp: string;
    visibility?: "staff" | "client" | "both";
  }>;
};

const STAGES = [
  { key: "profile", labelKey: "clx.stageProfile", icon: Check },
  { key: "documents", labelKey: "clx.stageDocuments", icon: FileText },
  { key: "review", labelKey: "clx.stageReview", icon: Clock },
  { key: "authority", labelKey: "clx.stageAuthority", icon: Upload },
  { key: "decision", labelKey: "clx.stageDecision", icon: Check },
] as const;

export function JourneyBar({
  caseData,
  className,
  events,
  onStageClick,
}: JourneyBarProps) {
  const { t } = useI18n();
  const progress = computeCaseProgress(caseData);

  const getStageStatus = (
    stageIndex: number
  ): "complete" | "current" | "upcoming" => {
    const stageMap: Record<string, number> = {
      ONBOARDING: 0,
      DATA_SUBMITTED: 0,
      DATA_APPROVED: 0,
      SERVICE_SELECTED: 0,
      SERVICE_APPROVED: 0,
      DOCS_REQUESTED: 1,
      IN_PROGRESS: 2,
      DISPATCHED: 3,
      FOLLOW_UP: 3,
      APPROVED_IN_PRINCIPLE: 4,
      COMPLETED: 4,
      CANCELLED: -1,
    };

    const currentStage = stageMap[caseData.status] ?? 0;

    if (caseData.status === "CANCELLED") {
      return "upcoming";
    }
    if (stageIndex < currentStage) return "complete";
    if (stageIndex === currentStage) return "current";
    return "upcoming";
  };

  const getNextStep = (): string => {
    if (progress.docsPending > 0) {
      return t("clx.naUploadMany", { n: progress.docsPending });
    }
    switch (caseData.status) {
      case "ONBOARDING":
        return t("clx.naCompleteProfile");
      case "DATA_SUBMITTED":
        return t("clx.naVerifying");
      case "DATA_APPROVED":
        return t("clx.naChooseProgramme");
      case "SERVICE_SELECTED":
        return t("clx.naAwaitingApproval");
      case "SERVICE_APPROVED":
        return t("clx.naPreparingRequests");
      case "DOCS_REQUESTED":
        return t("clx.naAllReceived");
      case "IN_PROGRESS":
        return t("clx.naPreparingDossier");
      case "DISPATCHED":
        return t("clx.naOnWay");
      case "FOLLOW_UP":
        return t("clx.naFollowUp");
      case "APPROVED_IN_PRINCIPLE":
        return t("clx.naApprovedReady");
      case "COMPLETED":
        return t("clx.naComplete");
      case "CANCELLED":
        return t("clx.naCancelled");
      default:
        return "";
    }
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{t("clx.progressEyebrow")}</CardTitle>
          <Badge variant="outline" className="text-sm font-semibold">
            {progress.percentage}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progress.percentage} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.docsApproved}/{progress.docsRequired}{" "}
              {t("clx.tabDocuments")}
            </span>
            <span>{getNextStep()}</span>
          </div>
        </div>

        {/* Stage indicators */}
        <div className="flex items-center justify-between">
          {STAGES.map((stage, index) => {
            const status = getStageStatus(index);
            const Icon = stage.icon;
            return (
              <div
                key={stage.key}
                className="flex flex-1 flex-col items-center"
              >
                <div className="flex w-full items-center">
                  {index > 0 && (
                    <div
                      className={cn(
                        "h-0.5 flex-1",
                        status === "complete" ? "bg-gold" : "bg-border"
                      )}
                    />
                  )}
                  {status !== "upcoming" && onStageClick ? (
                    <button
                      type="button"
                      onClick={() => onStageClick(index)}
                      title={`${t(stage.labelKey)} — ${
                        status === "complete" ? "done, review" : "current step"
                      }`}
                      aria-label={`${t(stage.labelKey)} — ${
                        status === "complete" ? "done, review" : "current step"
                      }`}
                      className={cn(
                        "flex h-8 min-h-8 w-8 min-w-8 items-center justify-center rounded-full border-2 transition-colors hover:ring-2 hover:ring-gold/50",
                        status === "complete" &&
                          "border-gold bg-gold text-cobble-ink",
                        status === "current" &&
                          "border-cobble bg-cobble text-[#F5F1EA]"
                      )}
                    >
                      {status === "complete" ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <div
                      title={t(stage.labelKey)}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                        status === "complete" &&
                          "border-gold bg-gold text-cobble-ink",
                        status === "current" &&
                          "border-cobble bg-cobble text-[#F5F1EA]",
                        status === "upcoming" &&
                          "border-border bg-background text-muted-foreground"
                      )}
                    >
                      {status === "complete" ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      )}
                    </div>
                  )}
                  {index < STAGES.length - 1 && (
                    <div
                      className={cn(
                        "h-0.5 flex-1",
                        getStageStatus(index + 1) === "complete"
                          ? "bg-gold"
                          : "bg-border"
                      )}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 text-center text-[10px] uppercase tracking-wider",
                    status === "current" && "font-semibold text-cobble-ink",
                    status === "complete" && "text-iron-ink",
                    status === "upcoming" && "text-muted-foreground"
                  )}
                >
                  {t(stage.labelKey)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Document status summary */}
        {progress.docsRequired > 0 && (
          <div className="flex flex-wrap gap-4 rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-olive-ink" />
              <span>
                {progress.docsApproved} {t("clx.fulfilledLabel")}
              </span>
            </div>
            {progress.docsPending > 0 && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-ink" />
                <span>{progress.docsPending} pending</span>
              </div>
            )}
            {progress.docsChangesRequested > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-coral" />
                <span>{progress.docsChangesRequested} changes requested</span>
              </div>
            )}
            {progress.docsRejected > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-coral" />
                <span>{progress.docsRejected} rejected</span>
              </div>
            )}
          </div>
        )}

        {/* E7 — latest recorded events: the journey reflects what happened */}
        {events &&
          events.filter((e) => e.visibility !== "staff").length > 0 && (
            <ul
              className="space-y-1.5 border-t border-border/60 pt-4"
              aria-label="Latest case events"
            >
              {events
                .filter((e) => e.visibility !== "staff")
                .slice(0, 5)
                .map((event) => (
                  <li
                    key={`${event.timestamp}-${event.title}`}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 truncate text-iron-ink">
                      {event.title}
                    </span>
                    <time
                      dateTime={event.timestamp}
                      className="shrink-0 tabular-nums text-muted-foreground"
                    >
                      {event.timestamp.slice(0, 10)}
                    </time>
                  </li>
                ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}
