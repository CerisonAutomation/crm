"use client";
/**
 * Evidence-readiness summary — shows what evidence the case has, what it lacks,
 * and where the risks lie. Used by the RM before dispatching and by the client
 * portal to show "what the desk is waiting for".
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, FileText, Shield, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle, Spinner } from "@/components/brand/ui";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { EvidenceReadinessSummary, ReadinessItem, ReadinessGap } from "@/lib/services/evidence-readiness";

export function EvidenceReadiness({ caseId }: { caseId: string }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<EvidenceReadinessSummary | null>(null);
  const [recordedBand, setRecordedBand] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await api.evidenceReadiness(caseId);
        setSummary(res.summary);
        const scores = await api.scoreHistory(caseId).catch(() => null);
        setRecordedBand(scores?.latest ? scores.latest.band : null);
      } catch (e) {
        toast({ title: "Failed to load", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [caseId]);

  if (loading) {
    return <Spinner />;
  }

  if (!summary) return null;

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <SectionTitle>{summary.programmeLabel}</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("evidence.readinessSubtitle", { score: summary.score })}
          </p>
        </div>
        <div className={cn(
          "text-3xl font-bold tabular-nums",
          summary.score >= 75 ? "text-gold-ink" : "text-cobble-ink"
        )}>
          {summary.score}%
        </div>
      </div>

      {/* Filing ready badge */}
      <Badge variant={summary.filingReady ? "default" : "destructive"}>
        {summary.filingReady ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
        {summary.filingReady ? t("evidence.filingReady") : t("evidence.notFilingReady")}
      </Badge>

      {/* Persisted score band (latest recorded submission score, if any) */}
      {recordedBand && (
        <Badge variant="outline">{recordedBand}</Badge>
      )}

      {/* Items table */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">{t("evidence.documents")}</h4>
        <div className="rounded-md border bg-card">
          {summary.items.map((item) => (
            <div
              key={item.key}
              className={cn(
                "flex items-center justify-between px-3 py-2 border-t",
                item.expired && "bg-destructive/5"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant={
                    item.satisfied ? "default" : item.expired ? "destructive" : "secondary"
                  }
                  className="shrink-0"
                >
                  {item.satisfied ? <CheckCircle2 className="h-3 w-3" /> : item.expired ? <Clock className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                </Badge>
                <span className="font-medium truncate">{item.label}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {item.certified && <span className="flex items-center gap-1">{<Shield className="h-3 w-3" />} {t("evidence.certified")}</span>}
                {item.validityMonths && <span>{t("evidence.validityMonths", { n: item.validityMonths })}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gaps */}
      {summary.gaps.length > 0 && (
        <div className="space-y-2 rounded-md border bg-destructive/5 p-3">
          <h4 className="text-sm font-medium text-destructive">{t("evidence.gaps")}</h4>
          <ul className="mt-2 space-y-1">
            {summary.gaps.map((gap) => (
              <li key={gap.key} className="flex items-center gap-2 text-sm">
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="font-medium">{gap.label}</span>
                <span className="text-muted-foreground">— {gap.reason}</span>
                <Badge variant="outline" className="ml-auto">
                  {gap.priority === "HIGH" && t("evidence.high")}
                  {gap.priority === "MEDIUM" && t("evidence.medium")}
                  {gap.priority === "LOW" && t("evidence.low")}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Strengths */}
      {summary.strengths.length > 0 && (
        <div className="space-y-2 rounded-md border bg-gold/5 p-3">
          <h4 className="text-sm font-medium text-gold-ink">{t("evidence.strengths")}</h4>
          <ul className="mt-2 space-y-1">
            {summary.strengths.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm text-gold-ink">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">— {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      {summary.risks.length > 0 && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <h4 className="text-sm font-medium text-muted-foreground">{t("evidence.risks")}</h4>
          <ul className="mt-2 space-y-1">
            {summary.risks.map((r) => (
              <li key={r.key} className="flex items-start gap-2 text-sm">
                <Shield className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">{r.label}</span>
                  <p className="text-muted-foreground">{r.concern}</p>
                  <p className="text-xs text-gold-ink">{t("evidence.action")} {r.action}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}