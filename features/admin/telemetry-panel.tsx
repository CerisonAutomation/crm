"use client";
/**
 * Admin · Telemetry & logs — the read side of the product-telemetry ledger.
 * Org-scoped, filterable by kind, with on-demand retention pruning.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow, SectionTitle, Spinner } from "@/components/brand/ui";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Row = {
  id: string; kind: string; name: string; view: string | null; path: string | null;
  role: string | null; status: number | null; durationMs: number | null; createdAt: string;
};

const KINDS = ["all", "view", "event", "api", "error"] as const;

export function AdminTelemetry() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Array<{ kind: string; count: number }>>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.telemetry({ kind: kind === "all" ? undefined : kind, take: 200 });
      setRows(res.events);
      setCounts(res.counts);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function prune() {
    setBusy(true);
    try {
      const res = await api.pruneTelemetry();
      toast({ title: t("telemetry.pruned"), description: `${res.pruned}` });
      await load();
    } catch {
      toast({ title: t("telemetry.loadError"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const countFor = (k: string) => counts.find((c) => c.kind === k)?.count ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Governance</Eyebrow>
          <SectionTitle className="mt-1.5">{t("telemetry.title")}</SectionTitle>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("telemetry.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> {t("telemetry.refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void prune()} disabled={busy}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t("telemetry.prune")}
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              kind === k ? "border-cobble bg-cobble text-[#F5F1EA]" : "border-limestone text-iron-ink hover:border-gold hover:text-cobble-ink",
            )}
          >
            {k === "all" ? t("telemetry.all") : k} · {k === "all" ? counts.reduce((a, c) => a + c.count, 0) : countFor(k)}
          </button>
        ))}
      </div>

      <Card className="gap-0 rounded-md border-border p-0">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
            <Spinner className="h-7 w-7" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 p-10 text-center">
            <Activity className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("telemetry.empty")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/70 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{t("telemetry.col.kind")}</th>
                  <th className="px-4 py-2.5">{t("telemetry.col.name")}</th>
                  <th className="px-4 py-2.5">{t("telemetry.col.context")}</th>
                  <th className="px-4 py-2.5">{t("telemetry.col.when")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs text-cobble-ink">{r.kind}</td>
                    <td className="max-w-[22rem] truncate px-4 py-2.5">{r.name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {r.view ?? r.path ?? "—"}
                      {r.status ? ` · ${r.status}` : ""}
                      {r.durationMs ? ` · ${r.durationMs}ms` : ""}
                      {r.role ? ` · ${r.role}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
