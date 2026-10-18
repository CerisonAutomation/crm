"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { get } from "@/lib/api-client";
import { Clock, CheckCircle, AlertTriangle, Pause } from "lucide-react";

interface SLAClock {
  id: string;
  name: string;
  targetHours: number;
  startedAt: string;
  deadlineAt: string;
  status: "ACTIVE" | "MET" | "BREACHED" | "PAUSED";
  caseId: string | null;
}

export function SLADashboard() {
  const { t } = useI18n();
  const [clocks, setClocks] = useState<SLAClock[]>([]);
  const [loading, setLoading] = useState(false);

  const loadClocks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await get<{ clocks: SLAClock[] }>("/api/sla/clocks");
      setClocks(response.clocks ?? []);
    } catch (error) {
      console.error("Failed to load SLA clocks:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClocks();
  }, [loadClocks]);

  function getStatusIcon(status: string) {
    switch (status) {
      case "MET":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "BREACHED":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "PAUSED":
        return <Pause className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-blue-500" />;
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "MET":
        return <Badge variant="default">{t("sla.met")}</Badge>;
      case "BREACHED":
        return <Badge variant="destructive">{t("sla.breached")}</Badge>;
      case "PAUSED":
        return <Badge variant="secondary">{t("sla.paused")}</Badge>;
      default:
        return <Badge variant="outline">{t("sla.active")}</Badge>;
    }
  }

  function getTimeRemaining(deadlineAt: string): string {
    const now = new Date();
    const deadline = new Date(deadlineAt);
    const diff = deadline.getTime() - now.getTime();

    if (diff <= 0) return t("sla.overdue");

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  }

  const activeClocks = clocks.filter((c) => c.status === "ACTIVE");
  const breachedClocks = clocks.filter((c) => c.status === "BREACHED");
  const metClocks = clocks.filter((c) => c.status === "MET");

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t("sla.title")}</h2>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("sla.active")}</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeClocks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("sla.breached")}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{breachedClocks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("sla.met")}</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metClocks.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sla.allClocks")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : clocks.length === 0 ? (
            <p className="text-muted-foreground">{t("sla.noClocks")}</p>
          ) : (
            <div className="space-y-2">
              {clocks.map((clock) => (
                <div
                  key={clock.id}
                  className="p-4 rounded-lg border border-border"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(clock.status)}
                      <span className="font-medium">{clock.name}</span>
                    </div>
                    {getStatusBadge(clock.status)}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {t("sla.target")}: {clock.targetHours}h
                    </span>
                    <span>
                      {t("sla.remaining")}: {getTimeRemaining(clock.deadlineAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
