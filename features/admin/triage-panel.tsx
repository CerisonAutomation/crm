"use client";
/**
 * TriagePanel — admin management for triage scoring.
 * Lists all cases with their triage scores and allows manual recalculation.
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
import { AdminPage, AdminPageHeader } from "@/components/brand/admin-surface";
import { useApiData, LoadingBlock, ErrorBlock } from "@/components/brand/data-state";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCcw, Trash2, Pencil, Zap, Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export type TriageTier = "P1" | "P2" | "P3";

export type TriageScore = {
  caseId: string;
  reference: string;
  tier: TriageTier;
  score: number;
  factors: string[];
  dwell?: {
    party: string;
    overdueDays: number;
    cost: number;
    reason: string;
  } | null;
};

export function TriagePanel() {
  const { t } = useI18n();
  const [showRecalculating, setShowRecalculating] = useState(false);
  const [showDetail, setShowDetail] = useState<{ caseId: string; score: TriageScore } | null>(null);

  const { data, loading, error, reload } = useApiData(() =>
    api.triage(),
  );

  const tierBadge = (tier: TriageTier) => {
    const config: Record<TriageTier, { variant: "default" | "destructive" | "secondary"; label: string }> = {
      P1: { variant: "destructive", label: t("triage.tier.p1") },
      P2: { variant: "secondary", label: t("triage.tier.p2") },
      P3: { variant: "default", label: t("triage.tier.p3") },
    };
    return config[tier];
  };

  const handleRecalculate = async () => {
    setShowRecalculating(true);
    try {
      await api.triageRecalculate();
      toast({ title: t("triage.recalculated") });
      reload();
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : t("common.error"),
        variant: "destructive",
      });
    } finally {
      setShowRecalculating(false);
    }
  };

  const openDetail = (entry: { caseId: string; score: TriageScore }) => {
    setShowDetail(entry);
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow={t("admin.triage")}
        title={t("triage.title")}
        desc={t("triage.intro")}
      />
      
      {(!data || data.queue.length === 0) ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("triage.emptyTitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("triage.emptyDescription")}
          </p>
          <Button variant="outline" size="sm" onClick={handleRecalculate}>
            {t("triage.recalculate")}
          </Button>
        </Card>
      ) : (
        <Card className="w-full">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead>{t("triage.column.case")}</TableHead>
                <TableHead>{t("triage.column.reference")}</TableHead>
                <TableHead>{t("triage.column.tier")}</TableHead>
                <TableHead>{t("triage.column.score")}</TableHead>
                <TableHead>{t("triage.column.factors")}</TableHead>
                <TableHead>{t("triage.column.dwell")}</TableHead>
                <TableHead className="w-24">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.queue.map((score) => (
                <TableRow key={score.caseId}>
                  <TableCell>
                    {score.caseId}
                  </TableCell>
                  <TableCell>
                    {score.reference}
                  </TableCell>
                  <TableCell>
                    <StateBadge
                      state={score.tier}
                      label={tierBadge(score.tier).label}
                    />
                  </TableCell>
                  <TableCell>
                    {score.score.toString()}
                  </TableCell>
                  <TableCell>
                    {score.factors.length > 0 ? (
                      <span className="text-xs text-cobble-ink">
                        {score.factors.join(", ")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {score.dwell ? (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-cobble-ink">
                          {score.dwell.party}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          +{score.dwell.overdueDays}d
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
                      onClick={() => openDetail({ caseId: score.caseId, score })}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      
      {/* Detail dialog */}
      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("triage.detailTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("triage.detail.caseId")}</Label>
                <p className="text-sm text-cobble-ink">{showDetail.score.caseId}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("triage.detail.reference")}</Label>
                <p className="text-sm text-muted-foreground">{showDetail.score.reference}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("triage.detail.tier")}</Label>
                <p className="text-sm text-cobble-ink">
                  {showDetail.score.tier === "P1" ? t("triage.tier.p1") :
                   showDetail.score.tier === "P2" ? t("triage.tier.p2") :
                   t("triage.tier.p3")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("triage.detail.score")}</Label>
                <p className="text-sm text-font-medium">{showDetail.score.score}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("triage.detail.factors")}</Label>
                {showDetail.score.factors.length > 0 ? (
                  <div className="space-y-1">
                    {showDetail.score.factors.map((factor, index) => (
                      <div key={index} className="flex justify-between">
                        <span>{factor}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("triage.detail.dwell")}</Label>
                {showDetail.score.dwell ? (
                  <>
                    <div className="space-y-2">
                      <Label>{t("triage.detail.dwell.party")}</Label>
                      <p className="text-sm text-muted-foreground">{showDetail.score.dwell.party}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("triage.detail.dwell.overdueDays")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {showDetail.score.dwell.overdueDays} days
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("triage.detail.dwell.cost")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {showDetail.score.dwell.cost}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("triage.detail.dwell.reason")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {showDetail.score.dwell.reason}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
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
      
      <div className="mt-6 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecalculate}
          disabled={showRecalculating}
        >
          {showRecalculating ? (
            <>
              <Spinner className="h-3 w-3 mr-2" />
              {t("common.recalculating")}
            </>
          ) : (
            <>
              <Activity className="h-3 w-3" />
              {t("triage.recalculate")}
            </>
          )}
        </Button>
      </div>
    </AdminPage>
  );
}