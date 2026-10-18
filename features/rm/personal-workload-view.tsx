"use client";
/**
 * Personal workload view — capacity vs SLA forecast for the signed-in RM.
 * Shows active cases by priority tier, estimated capacity consumption,
 * and SLA risk projection for the next 2 weeks.
 */

import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface QueueRow {
  id: string;
  reference: string;
  status: string;
  ageDays: number;
  dataApproval: string | null;
  serviceApproval: string | null;
  riskFlag: string;
  updatedAt: string;
}

interface TriageScore {
  caseId: string;
  tier: "P1" | "P2" | "P3";
  score: number;
  factors: string[];
}

interface PersonalWorkloadViewProps {
  row: QueueRow | null;
  triage: TriageScore | null;
}

const TIER_TONES: Record<
  "P1" | "P2" | "P3",
  "destructive" | "default" | "secondary"
> = {
  P1: "destructive",
  P2: "default",
  P3: "secondary",
};

const STAGE_WEIGHTS: Record<string, number> = {
  ONBOARDING: 0.1,
  DATA_SUBMITTED: 0.15,
  DATA_APPROVED: 0.2,
  SERVICE_SELECTED: 0.25,
  SERVICE_APPROVED: 0.3,
  DOCS_REQUESTED: 0.4,
  IN_PROGRESS: 0.6,
  DISPATCHED: 0.8,
  FOLLOW_UP: 0.9,
  APPROVED_IN_PRINCIPLE: 0.95,
  COMPLETED: 1.0,
  CANCELLED: 0,
};

function calculateCapacity(row: QueueRow, triage: TriageScore | null): number {
  const tier = triage?.tier ?? "P3";
  const stageWeight = STAGE_WEIGHTS[row.status] ?? 0.3;

  const tierMultiplier = tier === "P1" ? 1.5 : tier === "P2" ? 1.2 : 1.0;
  return Math.round(stageWeight * tierMultiplier * 100);
}

function getSLAProjection(
  row: QueueRow,
  triage: TriageScore | null
): {
  daysUntilBreach: number | null;
  risk: "high" | "medium" | "low";
} {
  const tier = triage?.tier ?? "P3";
  const ageDays = row.ageDays;

  const slaThresholds = { P1: 7, P2: 14, P3: 28 };
  const threshold = slaThresholds[tier];
  const daysUntilBreach = threshold - ageDays;

  let risk: "high" | "medium" | "low" = "low";
  if (daysUntilBreach <= 0) risk = "high";
  else if (daysUntilBreach <= 3) risk = "medium";

  return {
    daysUntilBreach: daysUntilBreach > 0 ? daysUntilBreach : null,
    risk,
  };
}

export function PersonalWorkloadView({
  row,
  triage,
}: PersonalWorkloadViewProps) {
  const { t } = useI18n();

  if (!row) return null;

  const capacity = calculateCapacity(row, triage);
  const slaProjection = getSLAProjection(row, triage);
  const tier = triage?.tier ?? "P3";

  const trend = capacity > 70 ? "up" : capacity > 40 ? "stable" : "down";
  const tierLabel = (k: "P1" | "P2" | "P3") =>
    k === "P1"
      ? t("rmq.tierCritical")
      : k === "P2"
      ? t("rmq.tierHigh")
      : t("rmq.tierStandard");
  const trendLabel =
    trend === "up"
      ? t("rmq.trendUp")
      : trend === "stable"
      ? t("rmq.trendStable")
      : t("rmq.trendDown");

  return (
    <Card className="rounded-md border-border p-5 md:p-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("rmq.capacityEyebrow")}
          </span>
          <h3 className="mt-1.5 font-editorial text-lg md:text-xl">
            {t("rmq.personalWorkload")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-iron-ink">
            <span className="font-semibold text-cobble-ink">{capacity}%</span>
            <span className="text-muted-foreground">
              {t("rmq.capacityUnit")}
            </span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="mt-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t("rmq.currentLoad")}
            </span>
            <span className="font-semibold text-cobble-ink">{capacity}%</span>
          </div>
          <Progress value={capacity} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {capacity >= 85
              ? t("rmq.workloadOverloaded")
              : capacity >= 65
              ? t("rmq.workloadHigh")
              : capacity >= 40
              ? t("rmq.workloadModerate")
              : t("rmq.workloadLight")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("rmq.slaRisk")}</span>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  slaProjection.risk === "high"
                    ? "destructive"
                    : slaProjection.risk === "medium"
                    ? "default"
                    : "secondary"
                }
                className="gap-1"
              >
                {slaProjection.risk === "high" && (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {slaProjection.risk === "medium" && (
                  <Clock className="h-3 w-3" />
                )}
                {slaProjection.risk === "low" && <Minus className="h-3 w-3" />}
                {slaProjection.daysUntilBreach !== null
                  ? t("rmq.slaDaysLeft", { n: slaProjection.daysUntilBreach })
                  : t("rmq.slaBreached")}
              </Badge>
            </div>
          </div>
          <Progress
            value={
              slaProjection.daysUntilBreach !== null
                ? Math.max(0, 100 - (slaProjection.daysUntilBreach / 14) * 100)
                : 100
            }
            className="h-1.5"
          />
          <p className="text-xs text-muted-foreground">
            {slaProjection.daysUntilBreach !== null
              ? t("rmq.slaProjection", { tier: tierLabel(tier) })
              : t("rmq.slaOverdue")}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-cobble-ink">
            {t("rmq.priorityMix")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["P1", "P2", "P3"] as const).map((tierKey) => (
              <Tooltip key={tierKey}>
                <TooltipTrigger asChild>
                  <Badge variant={TIER_TONES[tierKey]} className="gap-1">
                    {tierKey}{" "}
                    <span className="font-medium">
                      {tierKey === tier ? 1 : 0}
                    </span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-56 text-xs">
                    {t("rmq.tierDescription", { tier: tierLabel(tierKey) })}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("rmq.weeklyTrend")}</span>
          <div className="flex items-center gap-1.5">
            {trend === "up" && <TrendingUp className="h-4 w-4 text-coral" />}
            {trend === "down" && (
              <TrendingDown className="h-4 w-4 text-olive-ink" />
            )}
            {trend === "stable" && (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium text-cobble-ink">{trendLabel}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
