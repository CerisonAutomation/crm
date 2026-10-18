"use client";

/**
 * Operations — the staff watchlist.
 *
 * Two server endpoints (`/api/ops/alerts`, `/api/ops/audit-integrity`) were
 * built and authorised but nothing ever called them, so the desk had no way to
 * see what needs attention today. This panel is pure read wiring: it renders
 * what those routes already return and links into the views that act on it.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, FileWarning, Loader2, RefreshCw, ScrollText, ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Alerts = Awaited<ReturnType<typeof api.opsAlerts>>;
type Integrity = Awaited<ReturnType<typeof api.opsAuditIntegrity>>;

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function AdminOps() {
  const { t } = useI18n();
  const { setView, setActiveCase, session } = useApp();
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([api.opsAlerts(), api.opsAuditIntegrity()]);
      setAlerts(a);
      setIntegrity(i);
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function openCase(id: string) {
    setActiveCase(id);
  }

  const nothingWaiting =
    alerts !== null &&
    alerts.staleCases.length === 0 &&
    alerts.dueReminders.length === 0 &&
    alerts.openLetters.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-gold-ink">{t("ops.eyebrow")}</p>
          <h1 className="mt-1 font-editorial text-3xl text-cobble-ink">{t("ops.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("ops.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          disabled={refreshing}
          className="min-h-11"
        >
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {t("common.retry")}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <>
          {/* ── Audit ledger health ── */}
          {integrity && (
            <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="ops-integrity">
              <div className="flex items-center gap-2.5">
                <ScrollText className="h-4 w-4 text-gold-ink" aria-hidden />
                <h2 id="ops-integrity" className="font-editorial text-lg text-cobble-ink">
                  {t("ops.integrityTitle")}
                </h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("ops.integrityHint", { days: integrity.windowDays })}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Stat label={t("ops.statEvents")} value={integrity.total} />
                <Stat
                  label={t("ops.statSystem")}
                  value={integrity.systemRows}
                  hint={t("ops.statSystemHint")}
                />
                <Stat
                  label={t("ops.statUncorrelated")}
                  value={integrity.uncorrelated}
                  hint={t("ops.statUncorrelatedHint")}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    integrity.ok ? "bg-olive/15 text-olive-ink" : "bg-amber-ink/15 text-amber-ink",
                  )}
                >
                  {integrity.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {integrity.ok ? t("ops.integrityOk") : t("ops.integrityAttention")}
                </span>
                {/* The ledger is ADMIN + AUDITOR only, while this panel is also
                    open to SENIOR_RM — so the link is gated by role. Ungated, the
                    click set a view the role cannot open and the shell silently
                    bounced them back to the Case Queue. */}
                {session?.role === "ADMIN" && (
                  <button
                    type="button"
                    onClick={() => setView("admin-audit")}
                    className="text-xs font-semibold text-gold-ink hover:underline"
                  >
                    {t("ops.openAudit")} →
                  </button>
                )}
              </div>
            </section>
          )}

          {nothingWaiting && (
            <div className="flex items-center gap-3 rounded-md border border-olive/40 bg-olive/5 p-5 text-sm text-olive-ink">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              {t("ops.allClear")}
            </div>
          )}

          {/* ── Stale cases ── */}
          {alerts && alerts.staleCases.length > 0 && (
            <Watchlist
              id="ops-stale"
              icon={<Clock className="h-4 w-4 text-gold-ink" aria-hidden />}
              title={t("ops.staleTitle")}
              hint={t("ops.staleHint")}
              count={alerts.staleCases.length}
            >
              {alerts.staleCases.map((c) => (
                <Row key={c.id}>
                  <button
                    type="button"
                    onClick={() => openCase(c.id)}
                    className="font-medium text-cobble-ink hover:text-gold-ink hover:underline"
                  >
                    {c.reference}
                  </button>
                  <span className="text-muted-foreground">{c.status}</span>
                  <span className="text-muted-foreground">{relTime(c.updatedAt)}</span>
                </Row>
              ))}
            </Watchlist>
          )}

          {/* ── Due reminders ── */}
          {alerts && alerts.dueReminders.length > 0 && (
            <Watchlist
              id="ops-reminders"
              icon={<FileWarning className="h-4 w-4 text-gold-ink" aria-hidden />}
              title={t("ops.remindersTitle")}
              hint={t("ops.remindersHint")}
              count={alerts.dueReminders.length}
            >
              {alerts.dueReminders.map((r) => (
                <Row key={r.id}>
                  <span className="font-medium text-cobble-ink">{r.title}</span>
                  <span className="text-muted-foreground">{r.status}</span>
                  <span className="text-muted-foreground">{relTime(r.dueAt)}</span>
                </Row>
              ))}
            </Watchlist>
          )}

          {/* ── Letters awaiting approval ── */}
          {alerts && alerts.openLetters.length > 0 && (
            <Watchlist
              id="ops-letters"
              icon={<FileWarning className="h-4 w-4 text-gold-ink" aria-hidden />}
              title={t("ops.lettersTitle")}
              hint={t("ops.lettersHint")}
              count={alerts.openLetters.length}
            >
              {alerts.openLetters.map((l) => (
                <Row key={l.id}>
                  <button
                    type="button"
                    onClick={() => openCase(l.caseId)}
                    className="font-medium text-cobble-ink hover:text-gold-ink hover:underline"
                  >
                    {t("ops.openCase")}
                  </button>
                  <span className="text-muted-foreground">{relTime(l.createdAt)}</span>
                </Row>
              ))}
            </Watchlist>
          )}

          {alerts && (
            <p className="text-[11px] text-muted-foreground">
              {t("ops.generatedAt")} · {new Date(alerts.generatedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-editorial text-2xl text-cobble-ink">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Watchlist({
  id,
  icon,
  title,
  hint,
  count,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 id={id} className="font-editorial text-lg text-cobble-ink">
            {title}
          </h2>
        </div>
        <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[11px] font-semibold text-gold-ink">{count}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
      <ul className="mt-3 divide-y divide-border">{children}</ul>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">{children}</li>;
}
