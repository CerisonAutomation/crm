"use client";
/**
 * WebhooksPanel — admin management for outbound signed webhook endpoints.
 *
 * Create (show-once secret dialog), per-endpoint active toggle, secret
 * rotation, delete-with-confirm, real test-fire button and a delivery log
 * (status chip / attempts / response / error). Uses the shared api-client.
 */
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { api, type WebhookEndpoint, type WebhookDelivery } from "@/lib/api-client";
import { Eyebrow, StatusBadge, Spinner } from "@/components/brand/ui";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Activity, Check, Copy, KeyRound, RefreshCw, Send, Trash2, Webhook, XCircle,
} from "lucide-react";

type EndpointRow = WebhookEndpoint;
type DeliveryRow = WebhookDelivery;

/** The real outbound topic catalogue (mirrors the server contract). */
const TOPICS = [
  "case.created",
  "document.uploaded",
  "document.approved",
  "document.rejected",
  "case.status.changed",
  "dispatch.created",
  "letter.issued",
  "message.received",
  "page.submitted",
  "workflow.run.completed",
  "webhook.test",
] as const;

function fmtTime(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM HH:mm:ss");
  } catch {
    return "—";
  }
}

function deliveryTone(status: string): "green" | "red" | "amber" {
  return status === "SUCCEEDED" ? "green" : status === "FAILED" ? "red" : "amber";
}

// ───────────────────────── panel ─────────────────────────

export function WebhooksPanel() {
  const { t } = useI18n();
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [secretShown, setSecretShown] = useState<{ secret: string; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EndpointRow | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  // create form
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
      try {
        const data = await api.webhookEndpoints();
        setEndpoints(data.endpoints);
        setLoadError(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadDeliveries = useCallback(async (endpointId: string) => {
      setDeliveriesLoading(true);
      try {
        const data = await api.webhookDeliveries();
        // Filter by endpointId client-side since the API doesn't support query params yet
        setDeliveries(data.deliveries.filter((d) => d.endpointId === endpointId));
      } catch (e) {
        toast({
          title: t("hooks.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      } finally {
        setDeliveriesLoading(false);
      }
    }, [t]);

  function toggleEvents(topic: string) {
    setSelectedEvents((prev) => {
      if (topic === "*") return prev.includes("*") ? [] : ["*"];
      const withoutStar = prev.filter((e) => e !== "*");
      return withoutStar.includes(topic) ? withoutStar.filter((e) => e !== topic) : [...withoutStar, topic];
    });
  }

  async function createEndpoint() {
      if (!url.trim() || selectedEvents.length === 0) return;
      setCreating(true);
      try {
        const data = await api.createWebhookEndpoint({
          url: url.trim(),
          description: description.trim(),
          events: selectedEvents,
          active: true,
        });
        setSecretShown({ secret: data.secret, message: t("hooks.created") });
        setUrl("");
        setDescription("");
        setSelectedEvents([]);
        await reload();
      } catch (e) {
        toast({
          title: t("hooks.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      } finally {
        setCreating(false);
      }
    }

  async function toggleActive(row: EndpointRow, next: boolean) {
      setWorkingId(row.id);
      try {
        await api.updateWebhookEndpoint(row.id, { active: next });
        toast({ title: next ? t("hooks.active") : t("hooks.inactive"), description: row.url });
        await reload();
      } catch (e) {
        toast({
          title: t("hooks.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      } finally {
        setWorkingId(null);
      }
    }

  async function rotateSecret(row: EndpointRow) {
      setWorkingId(row.id);
      try {
        const data = await api.rotateWebhookSecret(row.id);
        setSecretShown({ secret: data.secret, message: t("hooks.rotated") });
        await reload();
      } catch (e) {
        toast({
          title: t("hooks.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      } finally {
        setWorkingId(null);
      }
    }

  async function deleteEndpoint(row: EndpointRow) {
      setWorkingId(row.id);
      try {
        await api.deleteWebhookEndpoint(row.id);
        toast({ title: t("hooks.deleted"), description: row.url });
        if (expanded === row.id) {
          setExpanded(null);
          setDeliveries([]);
        }
        await reload();
      } catch (e) {
        toast({
          title: t("hooks.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      } finally {
        setWorkingId(null);
        setPendingDelete(null);
      }
    }

  async function sendTest(row: EndpointRow) {
      setTestingId(row.id);
      try {
        const data = await api.testWebhookEndpoint(row.id);
        if (data.delivered) {
          toast({
            title: t("hooks.testOk"),
            description: `${row.url} · ${data.delivery.responseStatus ?? ""}`,
          });
        } else {
          toast({
            title: t("hooks.testFailed"),
            description: data.delivery.nextAttemptAt ? t("hooks.testQueued") : data.delivery.error ?? undefined,
            variant: "destructive",
          });
        }
        await reload();
        if (expanded === row.id) await loadDeliveries(row.id);
      } catch (e) {
        toast({
          title: t("hooks.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      } finally {
        setTestingId(null);
      }
    }

  function expandDeliveries(row: EndpointRow) {
    if (expanded === row.id) {
      setExpanded(null);
      setDeliveries([]);
      return;
    }
    setExpanded(row.id);
    setDeliveries([]);
    void loadDeliveries(row.id);
  }

  return (
    <div className="space-y-6">
      <Card className="gap-0 rounded-md border-border p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cobble">
            <Webhook className="h-4.5 w-4.5 text-[#F5F1EA]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Eyebrow>{t("hooks.eyebrow")}</Eyebrow>
            <h3 className="mt-1 font-editorial text-lg text-cobble-ink">{t("hooks.title")}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("hooks.intro")}</p>
          </div>
        </div>

        {/* create form */}
        <div className="mt-5 rounded border border-border/70 bg-muted/20 p-4">
          <p className="text-[13px] font-semibold text-cobble-ink">{t("hooks.createTitle")}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url" className="text-[13px]">
                {t("hooks.urlLabel")} <span className="ml-0.5 text-gold-ink" aria-hidden="true">*</span>
              </Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("hooks.urlPlaceholder")}
                autoComplete="off"
                className="rounded-none border-input focus-visible:ring-gold"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-desc" className="text-[13px]">{t("hooks.descLabel")}</Label>
              <Input
                id="webhook-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("hooks.descPlaceholder")}
                autoComplete="off"
                className="rounded-none border-input focus-visible:ring-gold"
              />
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label className="text-[13px]">
              {t("hooks.eventsLabel")} <span className="ml-0.5 text-gold-ink" aria-hidden="true">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleEvents("*")}
                aria-pressed={selectedEvents.includes("*")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold transition-colors",
                  selectedEvents.includes("*")
                    ? "border-cobble bg-cobble text-[#F5F1EA]"
                    : "border-border bg-card text-iron-ink hover:border-gold",
                )}
              >
                {selectedEvents.includes("*") && <Check className="h-3 w-3" aria-hidden="true" />}
                {t("hooks.eventsAll")}
              </button>
              {TOPICS.map((topic) => {
                const on = selectedEvents.includes(topic);
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => toggleEvents(topic)}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors",
                      on
                        ? "border-cobble bg-cobble text-[#F5F1EA]"
                        : "border-border bg-card text-iron-ink hover:border-gold",
                      selectedEvents.includes("*") && !on && "opacity-50",
                    )}
                  >
                    {on && <Check className="h-3 w-3" aria-hidden="true" />}
                    {topic}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("hooks.eventsHint")}</p>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              size="sm"
              className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
              disabled={creating || !url.trim() || selectedEvents.length === 0}
              onClick={() => void createEndpoint()}
            >
              {creating ? (
                <>
                  <Spinner className="mr-2 h-3 w-3" />
                  {t("hooks.creating")}
                </>
              ) : (
                <>
                  <Webhook className="mr-2 h-3.5 w-3.5" />
                  {t("hooks.create")}
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* endpoint list */}
      {loading ? (
        <LoadingRow />
      ) : loadError ? (
        <Card className="rounded-md border-coral/50 bg-coral/5 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger-ink">
            <XCircle className="h-4 w-4" aria-hidden="true" /> {t("hooks.error")}
          </p>
          <p className="mt-1 text-sm text-iron-ink">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void reload()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      ) : endpoints.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-10 text-center">
          <Webhook className="h-5 w-5 text-gold-ink" aria-hidden="true" />
          <p className="mt-2 font-editorial text-base text-cobble-ink">{t("hooks.empty")}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {endpoints.map((row) => (
            <Card key={row.id} className="gap-0 rounded-md border-border p-0">
              {/* header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-3.5 w-3.5 shrink-0 text-gold-ink" aria-hidden="true" />
                    <p className="truncate font-mono text-xs text-cobble-ink" title={row.url}>{row.url}</p>
                  </div>
                  <p className="mt-1 text-sm text-iron-ink">{row.description || "—"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("hooks.counts", { total: row.counts.total, succeeded: row.counts.succeeded, failed: row.counts.failed })}
                    {" · "}
                    <span className="font-mono">{row.secretHint}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={row.active ? t("hooks.active") : t("hooks.inactive")}
                    tone={row.active ? "green" : "neutral"}
                  />
                  <Switch
                    checked={row.active}
                    disabled={workingId === row.id}
                    aria-label={`${row.url} — ${row.active ? t("hooks.active") : t("hooks.inactive")}`}
                    onCheckedChange={(next) => void toggleActive(row, next)}
                  />
                </div>
              </div>

              {/* subscribed events */}
              <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
                {row.events.map((ev) => (
                  <span key={ev} className="rounded bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-iron-ink">
                    {ev}
                  </span>
                ))}
              </div>

              {/* actions */}
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-3">
                <Button variant="outline" size="sm" disabled={testingId === row.id} onClick={() => void sendTest(row)}>
                  {testingId === row.id ? <Spinner className="mr-2 h-3 w-3" /> : <Send className="mr-2 h-3.5 w-3.5 text-gold-ink" />}
                  {testingId === row.id ? t("hooks.testing") : t("hooks.test")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => expandDeliveries(row)}>
                  <Activity className="mr-2 h-3.5 w-3.5 text-gold-ink" />
                  {t("hooks.deliveries")}
                </Button>
                <Button variant="outline" size="sm" disabled={workingId === row.id} onClick={() => void rotateSecret(row)}>
                  <KeyRound className="mr-2 h-3.5 w-3.5 text-gold-ink" />
                  {t("hooks.rotate")}
                </Button>
                <Button variant="outline" size="sm" className="border-coral/40 text-danger-ink hover:bg-coral/10" disabled={workingId === row.id} onClick={() => setPendingDelete(row)}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {t("hooks.delete")}
                </Button>
              </div>

              {/* delivery log */}
              {expanded === row.id && (
                <div className="border-t border-border/60">
                  <div className="flex items-center justify-between px-5 py-3">
                    <p className="text-[13px] font-semibold text-cobble-ink">{t("hooks.deliveriesTitle")}</p>
                    <Button variant="ghost" size="sm" onClick={() => void loadDeliveries(row.id)}>
                      <RefreshCw className="mr-2 h-3 w-3" /> Refresh
                    </Button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-32">{t("hooks.colTime")}</TableHead>
                            <TableHead className="w-44">{t("hooks.colTopic")}</TableHead>
                            <TableHead className="w-28">{t("hooks.colResult")}</TableHead>
                            <TableHead className="w-20 text-right">{t("hooks.colAttempts")}</TableHead>
                            <TableHead className="w-24">{t("hooks.colResponse")}</TableHead>
                            <TableHead>{t("hooks.colError")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deliveriesLoading && deliveries.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="py-8">
                                <LoadingRow bare />
                              </TableCell>
                            </TableRow>
                          ) : deliveries.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                                {t("hooks.noDeliveries")}
                              </TableCell>
                            </TableRow>
                          ) : (
                            deliveries.map((d) => (
                              <TableRow key={d.id}>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTime(d.createdAt)}</TableCell>
                                <TableCell className="font-mono text-xs text-cobble-ink">{d.topic}</TableCell>
                                <TableCell>
                                  <StatusBadge
                                    status={d.status === "SUCCEEDED" ? t("hooks.statusSucceeded") : d.status === "FAILED" ? t("hooks.statusFailed") : t("hooks.statusPending")}
                                    tone={deliveryTone(d.status)}
                                  />
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums text-iron-ink">{d.attempts}/5</TableCell>
                                <TableCell className="text-xs tabular-nums text-iron-ink">{d.responseStatus ?? "—"}</TableCell>
                                <TableCell className="max-w-64">
                                  <p className="truncate text-xs text-muted-foreground" title={d.error ?? undefined}>
                                    {d.error ?? (d.nextAttemptAt ? `${t("hooks.retryAt")} · ${fmtTime(d.nextAttemptAt)}` : d.status === "SUCCEEDED" ? `${t("hooks.statusSucceeded")} · ${fmtTime(d.deliveredAt)}` : "—")}
                                  </p>
                                  {d.nextAttemptAt && d.status === "FAILED" && (
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t("hooks.retryAt")} · {fmtTime(d.nextAttemptAt)}</p>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* show-once secret dialog */}
      <Dialog open={secretShown !== null} onOpenChange={(open) => !open && setSecretShown(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-editorial text-cobble-ink">
              <KeyRound className="h-4 w-4 text-gold-ink" aria-hidden="true" />
              {secretShown?.message ?? ""}
            </DialogTitle>
            <DialogDescription>{t("hooks.secretIntro")}</DialogDescription>
          </DialogHeader>
          {secretShown && <SecretBox secret={secretShown.secret} />}
          <DialogFooter>
            <Button size="sm" className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]" onClick={() => setSecretShown(null)}>
              {t("hooks.secretDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirmation */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-editorial text-cobble-ink">{t("hooks.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("hooks.deleteBody")}
              {pendingDelete && <span className="mt-2 block font-mono text-xs text-iron-ink">{pendingDelete.url}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#b04a48] text-[#F5F1EA] hover:bg-[#963c3a]"
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) void deleteEndpoint(pendingDelete);
              }}
            >
              {t("hooks.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ───────────────────────── pieces ─────────────────────────

function LoadingRow({ bare }: { bare?: boolean }) {
  return (
    <div className={cn("flex items-center justify-center gap-3 text-sm text-muted-foreground", !bare && "py-10")}>
      <Spinner className="h-4 w-4" />
      <span>Loading…</span>
    </div>
  );
}

/** Secret with copy-to-clipboard (never rendered after the dialog closes). */
function SecretBox({ secret }: { secret: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
    } catch {
      // clipboard API can be unavailable (iframe sandbox) — fall back to selection
      const el = document.getElementById("webhook-secret-value");
      if (el instanceof HTMLInputElement) {
        el.select();
        document.execCommand("copy");
      }
    }
    setCopied(true);
    toast({ title: t("hooks.copied") });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          id="webhook-secret-value"
          readOnly
          value={secret}
          onFocus={(e) => e.target.select()}
          className="rounded-none border-input bg-muted/40 font-mono text-xs"
        />
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void copy()}>
          {copied ? <Check className="mr-2 h-3.5 w-3.5 text-olive-ink" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
          {copied ? t("hooks.copied") : t("hooks.copy")}
        </Button>
      </div>
    </div>
  );
}
