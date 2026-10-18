"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { get, post } from "@/lib/api-client";
import { AlertTriangle, CheckCircle, XCircle, RefreshCw } from "lucide-react";

interface ReconciliationRun {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalCount: number;
  matchCount: number;
  mismatchCount: number;
  error: string | null;
}

interface ReconciliationFinding {
  id: string;
  entityType: string;
  entityId: string;
  field: string | null;
  expected: string | null;
  actual: string | null;
  severity: string;
  status: string;
}

export function ReconciliationConsole() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ReconciliationRun | null>(null);
  const [findings, setFindings] = useState<ReconciliationFinding[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    if (selectedRun) {
      loadFindings(selectedRun.id);
    }
  }, [selectedRun]);

  async function loadRuns() {
    setLoading(true);
    try {
      const response = await get<{ runs: ReconciliationRun[] }>("/api/reconciliation/runs");
      setRuns(response.runs ?? []);
    } catch (error) {
      console.error("Failed to load reconciliation runs:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadFindings(runId: string) {
    try {
      const response = await get<{ findings: ReconciliationFinding[] }>(
        `/api/reconciliation/runs/${runId}/findings`,
      );
      setFindings(response.findings ?? []);
    } catch (error) {
      console.error("Failed to load findings:", error);
    }
  }

  async function startReconciliation(type: string) {
    try {
      await post("/api/reconciliation/runs", { type });
      await loadRuns();
    } catch (error) {
      console.error("Failed to start reconciliation:", error);
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "COMPLETED":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "FAILED":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />;
    }
  }

  function getSeverityBadge(severity: string) {
    switch (severity) {
      case "CRITICAL":
        return <Badge variant="destructive">{t("severity.critical")}</Badge>;
      case "WARNING":
        return <Badge variant="secondary">{t("severity.warning")}</Badge>;
      default:
        return <Badge variant="outline">{t("severity.info")}</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("reconciliation.title")}</h2>
        <div className="flex gap-2">
          <Button onClick={() => startReconciliation("PROVIDER")} variant="outline">
            {t("reconciliation.runProvider")}
          </Button>
          <Button onClick={() => startReconciliation("PAYMENT")} variant="outline">
            {t("reconciliation.runPayment")}
          </Button>
          <Button onClick={() => startReconciliation("CASE")} variant="outline">
            {t("reconciliation.runCase")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("reconciliation.runs")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">{t("common.loading")}</p>
            ) : runs.length === 0 ? (
              <p className="text-muted-foreground">{t("reconciliation.noRuns")}</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedRun?.id === run.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <span className="font-medium">{run.type}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {new Date(run.startedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
                      <span>{t("reconciliation.total")}: {run.totalCount}</span>
                      <span className="text-green-600">{t("reconciliation.matched")}: {run.matchCount}</span>
                      <span className="text-red-600">{t("reconciliation.mismatched")}: {run.mismatchCount}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("reconciliation.findings")}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedRun ? (
              <p className="text-muted-foreground">{t("reconciliation.selectRun")}</p>
            ) : findings.length === 0 ? (
              <p className="text-muted-foreground">{t("reconciliation.noFindings")}</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {findings.map((finding) => (
                  <div
                    key={finding.id}
                    className="p-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{finding.entityType}</span>
                      {getSeverityBadge(finding.severity)}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      <div>{t("reconciliation.field")}: {finding.field ?? "-"}</div>
                      <div>{t("reconciliation.expected")}: {finding.expected ?? "-"}</div>
                      <div>{t("reconciliation.actual")}: {finding.actual ?? "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
