"use client";
/**
 * AutopilotPanel — automation auto-detection & auto-generation, in one place.
 *
 *  · Scan      — detect every exposable workflow, its trigger and the outbound
 *                topics it is predicted to emit (deterministic auto-context).
 *  · Provision — generate/repair a secured, signed inbound hook URL per
 *                published workflow (idempotent; secrets shown once).
 *  · Manage    — copy URL, rotate token+secret, enable/disable, delete.
 *
 * Talks to /api/autopilot via the shared typed api client. ADMIN only.
 */
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { api, type AutopilotEndpoint, type AutopilotPlanItem, type AutopilotResource } from "@/lib/api-client";
import { Eyebrow, StatusBadge, Spinner } from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Check, Copy, KeyRound, Radar, RefreshCw, Sparkles, Trash2, Wand2, Zap } from "lucide-react";

function fmt(d: string | null): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM HH:mm");
  } catch {
    return "—";
  }
}

function actionTone(action: AutopilotPlanItem["action"]): "green" | "amber" | "neutral" {
  return action === "create" ? "amber" : action === "repair" ? "amber" : "green";
}

/** Copy to clipboard with an execCommand fallback for sandboxed iframes. */
async function copyText(value: string, fallbackId: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const el = document.getElementById(fallbackId);
    if (el instanceof HTMLInputElement) {
      el.select();
      try {
        document.execCommand("copy");
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function AutopilotPanel() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string | null } | null>(null);
  const [resources, setResources] = useState<AutopilotResource[]>([]);
  const [plan, setPlan] = useState<AutopilotPlanItem[]>([]);
  const [endpoints, setEndpoints] = useState<AutopilotEndpoint[]>([]);
  const [scanning, setScanning] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [secretShown, setSecretShown] = useState<{ secret: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.autopilot();
      setResources(data.resources);
      setPlan(data.plan);
      setEndpoints(data.endpoints);
      setError(null);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const absoluteUrl = (path: string) => (globalThis.window === undefined ? path : `${window.location.origin}${path}`);

  async function scan() {
    setScanning(true);
    try {
      const res = await api.autopilotScan();
      setResources(res.resources);
      setPlan(res.plan);
      toast({
        title: t("autopilot.scanComplete"),
        description: t("autopilot.scanSummary", {
          exposable: res.summary.exposable,
          toCreate: res.summary.toCreate,
          toRepair: res.summary.toRepair,
        }),
      });
    } catch (e) {
      toast({ title: t("autopilot.scanFailed"), description: e instanceof Error ? e.message : t("autopilot.requestFailed"), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }

  async function provision() {
    setProvisioning(true);
    try {
      const res = await api.autopilotProvision();
      setEndpoints(res.endpoints);
      const withSecret = res.outcomes.find((o) => o.secret);
      if (withSecret?.secret) {
        setSecretShown({ secret: withSecret.secret, message: t("autopilot.secretNew") });
      }
      toast({
        title: res.created + res.repaired === 0 ? t("autopilot.nothingToProvision") : t("autopilot.provisionComplete"),
        description: t("autopilot.provisionSummary", { created: res.created, repaired: res.repaired }),
      });
      await load();
    } catch (e) {
      toast({ title: t("autopilot.provisionFailed"), description: e instanceof Error ? e.message : t("autopilot.requestFailed"), variant: "destructive" });
    } finally {
      setProvisioning(false);
    }
  }

  async function toggle(row: AutopilotEndpoint, active: boolean) {
    setWorkingId(row.id);
    try {
      const res = await api.autopilotToggle(row.id, active);
      setEndpoints((prev) => prev.map((e) => (e.id === row.id ? res.endpoint : e)));
      toast({ title: active ? t("autopilot.hookEnabled") : t("autopilot.hookDisabled"), description: row.url });
    } catch (e) {
      toast({ title: t("autopilot.updateFailed"), description: e instanceof Error ? e.message : t("autopilot.requestFailed"), variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  async function rotate(row: AutopilotEndpoint) {
    setWorkingId(row.id);
    try {
      const res = await api.autopilotRotate(row.id);
      setEndpoints((prev) => prev.map((e) => (e.id === row.id ? res.endpoint : e)));
      setSecretShown({ secret: res.secret, message: t("autopilot.secretRotated") });
      toast({ title: t("autopilot.hookRotated"), description: t("autopilot.rotatedBody") });
    } catch (e) {
      toast({ title: t("autopilot.rotateFailed"), description: e instanceof Error ? e.message : t("autopilot.requestFailed"), variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  async function remove(row: AutopilotEndpoint) {
    setWorkingId(row.id);
    try {
      await api.autopilotDelete(row.id);
      setEndpoints((prev) => prev.filter((e) => e.id !== row.id));
      toast({ title: t("autopilot.hookDeleted"), description: row.url });
    } catch (e) {
      toast({ title: t("autopilot.deleteFailed"), description: e instanceof Error ? e.message : t("autopilot.requestFailed"), variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  const toCreate = plan.filter((p) => p.action === "create").length;
  const toRepair = plan.filter((p) => p.action === "repair").length;

  return (
    <div className="space-y-6">
      <Card className="gap-0 rounded-md border-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cobble">
              <Radar className="h-4.5 w-4.5 text-[#F5F1EA]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <Eyebrow>{t("autopilot.eyebrow")}</Eyebrow>
              <h3 className="mt-1 font-editorial text-lg text-cobble-ink">{t("autopilot.title")}</h3>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t("autopilot.desc")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={scanning} onClick={() => void scan()}>
              {scanning ? <Spinner className="mr-2 h-3 w-3" /> : <Sparkles className="mr-2 h-3.5 w-3.5 text-gold-ink" />}
              {t("autopilot.scan")}
            </Button>
            <Button
              size="sm"
              className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
              disabled={provisioning}
              onClick={() => void provision()}
            >
              {provisioning ? <Spinner className="mr-2 h-3 w-3" /> : <Wand2 className="mr-2 h-3.5 w-3.5" />}
              {t("autopilot.provisionAll")}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Stat label={t("autopilot.exposable")} value={plan.length} />
          <Stat label={t("autopilot.willCreate")} value={toCreate} tone={toCreate > 0 ? "amber" : "neutral"} />
          <Stat label={t("autopilot.willRepair")} value={toRepair} tone={toRepair > 0 ? "amber" : "neutral"} />
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> <span>{t("autopilot.loading")}</span>
        </div>
      ) : error ? (
        <Card className="rounded-md border-coral/50 bg-coral/5 p-6">
          <p className="text-sm font-semibold text-danger-ink">{error.message ?? t("autopilot.requestFailed")}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> {t("autopilot.retry")}
          </Button>
        </Card>
      ) : (
        <>
          {/* Detected & predicted */}
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="border-b border-border/60 px-5 py-4">
              <p className="font-editorial text-base text-cobble-ink">{t("autopilot.detected")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t("autopilot.detectedHint")}
              </p>
            </div>
            {resources.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("autopilot.noWorkflows")}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {resources.map((r) => {
                  const planItem = plan.find((p) => p.workflowId === r.workflowId);
                  return (
                    <li key={r.workflowId} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Zap className={cn("h-3.5 w-3.5 shrink-0", r.published ? "text-gold-ink" : "text-muted-foreground")} aria-hidden="true" />
                            <p className="truncate text-sm font-semibold text-cobble-ink" title={r.name}>{r.name}</p>
                            {r.published ? (
                              <StatusBadge status="published" tone="green" />
                            ) : (
                              <StatusBadge status="draft" tone="neutral" />
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("autopilot.trigger")} <span className="font-mono text-iron-ink">{r.triggerKey ?? t("autopilot.none")}</span>
                            {r.triggerLabel ? ` · ${r.triggerLabel}` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {r.predictedTopics.map((topic) => (
                              <span key={topic} className="rounded bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-iron-ink">{topic}</span>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[11px] italic text-muted-foreground">{r.rationale}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {planItem && (
                            <StatusBadge status={planItem.action} tone={actionTone(planItem.action)} />
                          )}
                          {r.url ? (
                            <code className="max-w-[280px] truncate rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-iron-ink" title={r.url}>
                              {r.url}
                            </code>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{t("autopilot.noHookYet")}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Generated endpoints */}
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="border-b border-border/60 px-5 py-4">
              <p className="font-editorial text-base text-cobble-ink">{t("autopilot.endpoints")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Every call must be signed: <span className="font-mono">X-Signature: sha256=&lt;hmac(body, secret)&gt;</span>.
              </p>
            </div>
            {endpoints.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No hooks generated yet — run <span className="font-medium">Provision all</span>.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {endpoints.map((e) => (
                  <li key={e.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-cobble-ink" title={e.workflowName}>{e.workflowName}</p>
                        <code className="mt-1 block max-w-[420px] truncate font-mono text-[11px] text-iron-ink" title={e.url}>{e.url}</code>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {e.calls} call{e.calls === 1 ? "" : "s"} · {t("autopilot.last")} {fmt(e.lastUsedAt)} · <span className="font-mono">{e.secretHint}</span> · {e.source}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={e.active ? "active" : "inactive"} tone={e.active ? "green" : "neutral"} />
                        <Switch
                          checked={e.active}
                          disabled={workingId === e.id}
                          aria-label={t(e.active ? "autopilot.hookActiveAria" : "autopilot.hookInactiveAria", { name: e.workflowName })}
                          onCheckedChange={(next) => void toggle(e, next)}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const ok = await copyText(absoluteUrl(e.url), `autopilot-url-${e.id}`);
                            if (ok) {
                              setCopied(e.id);
                              toast({ title: t("autopilot.urlCopied"), description: e.url });
                              setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 2000);
                            }
                          }}
                        >
                          {copied === e.id ? <Check className="mr-2 h-3.5 w-3.5 text-olive-ink" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
                          {t("autopilot.copy")}
                        </Button>
                        <Button variant="outline" size="sm" disabled={workingId === e.id} onClick={() => void rotate(e)}>
                          <KeyRound className="mr-2 h-3.5 w-3.5 text-gold-ink" /> {t("autopilot.rotate")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-coral/40 text-danger-ink hover:bg-coral/10"
                          disabled={workingId === e.id}
                          onClick={() => void remove(e)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("autopilot.delete")}
                        </Button>
                      </div>
                    </div>
                    <input id={`autopilot-url-${e.id}`} readOnly value={absoluteUrl(e.url)} className="sr-only" aria-hidden="true" tabIndex={-1} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {/* show-once secret dialog */}
      <Dialog open={secretShown !== null} onOpenChange={(open) => !open && setSecretShown(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-editorial text-cobble-ink">
              <KeyRound className="h-4 w-4 text-gold-ink" aria-hidden="true" />
              {secretShown?.message ?? ""}
            </DialogTitle>
            <DialogDescription>
              Store this signing secret now — it is shown once and used to compute
              <span className="font-mono"> X-Signature</span> for every inbound call.
            </DialogDescription>
          </DialogHeader>
          {secretShown && (
            <Input readOnly value={secretShown.secret} onFocus={(e) => e.target.select()} className="rounded-none border-input bg-muted/40 font-mono text-xs" />
          )}
          <DialogFooter>
            <Button
              size="sm"
              className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
              onClick={async () => {
                if (secretShown) await copyText(secretShown.secret, "autopilot-secret");
                setSecretShown(null);
              }}
            >
              {t("autopilot.copyClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "amber" }) {
  return (
    <div className="rounded border border-border/70 bg-muted/20 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-editorial text-2xl", tone === "amber" ? "text-gold-ink" : "text-cobble-ink")}>{value}</p>
    </div>
  );
}
