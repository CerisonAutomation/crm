"use client";
/**
 * Admin · Regulatory watch — the news-scan panel.
 * Lists scan profiles and findings, with run/corroborate/approve/dismiss actions.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, Eye, Play, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow, SectionTitle, Spinner } from "@/components/brand/ui";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Profile = {
  id: string; label: string; sources: unknown; keywords: unknown;
  checkEveryHours: number; active: boolean; lastRunAt: string | null; createdAt: string;
};

type Finding = {
  id: string; profileId: string; sourceUrl: string; sourceLabel: string | null;
  contentHash: string; previousHash: string | null; proposal: unknown; excerpt: string;
  evidenceUrl: string; confidence: number; status: string; diff: unknown; importance: string;
  corroboratedBy: string | null; decidedBy: string | null; decidedAt: string | null;
  decisionReason: string | null; createdAt: string;
};

export function AdminNewsScan() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.newsScan();
      setProfiles(res.profiles);
      setFindings(res.findings);
    } catch {
      setProfiles([]);
      setFindings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runScan(profileId: string) {
    setBusyId(profileId);
    try {
      const res = await api.newsScanRun(profileId);
      toast({ title: "Scan complete", description: `${res.result.changed} change(s) found` });
      await load();
    } catch (e) {
      toast({ title: "Scan failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function act(findingId: string, action: "corroborate" | "approve" | "dismiss", sourceUrl?: string) {
    setBusyId(findingId);
    try {
      if (action === "corroborate" && sourceUrl) {
        await api.newsScanCorroborate(findingId, sourceUrl);
      } else if (action === "approve") {
        await api.newsScanApprove(findingId, "Approved by admin");
      } else {
        await api.newsScanDismiss(findingId, "Dismissed by admin");
      }
      toast({ title: "Done" });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
      <div className="mb-6">
        <Eyebrow>Governance</Eyebrow>
        <SectionTitle className="mt-1.5">Regulatory Watch</SectionTitle>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Monitor official sources for programme changes. Nothing auto-publishes — every finding is a proposal an admin reviews.
        </p>
      </div>

      {/* Profiles */}
      <div className="mb-8">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Scan Profiles</h3>
        {profiles.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No scan profiles configured.</Card>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <Card key={p.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Every {p.checkEveryHours}h · {p.active ? "Active" : "Paused"}
                    {p.lastRunAt && ` · Last run ${new Date(p.lastRunAt).toLocaleString()}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runScan(p.id)}
                  disabled={busyId === p.id}
                >
                  {busyId === p.id ? <Spinner className="h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                  Run scan
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Findings */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Findings</h3>
        {findings.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No findings yet. Run a scan to detect changes.</Card>
        ) : (
          <div className="space-y-3">
            {findings.map((f) => (
              <Card key={f.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={f.importance === "IMPORTANT" ? "destructive" : "secondary"}>
                        {f.importance}
                      </Badge>
                      <Badge variant={f.status === "APPROVED" ? "default" : f.status === "DISMISSED" ? "secondary" : "outline"}>
                        {f.status}
                      </Badge>
                      {f.corroboratedBy && (
                        <Badge variant="default">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Corroborated
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      {f.sourceLabel ?? f.sourceUrl}
                    </div>
                    {f.excerpt && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{f.excerpt}</p>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      Confidence {f.confidence}% · {new Date(f.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {f.status === "PENDING" && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void act(f.id, "corroborate", "https://example.gov.mt/confirm")}
                        disabled={busyId === f.id}
                      >
                        <Eye className="mr-1 h-3 w-3" /> Corroborate
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void act(f.id, "approve")}
                        disabled={busyId === f.id}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void act(f.id, "dismiss")}
                        disabled={busyId === f.id}
                      >
                        <XCircle className="mr-1 h-3 w-3" /> Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}