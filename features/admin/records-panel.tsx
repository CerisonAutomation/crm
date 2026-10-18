"use client";

/**
 * Records — the three ledgers that had working endpoints and no screen.
 *
 * `/api/finance`, `/api/renewals` and `/api/privacy/requests` were all
 * authorised and functional; nothing called them, so invoices could not be
 * raised, obligations could not be scheduled and data-subject requests could
 * not be triaged anywhere in the product. One destination, three tabs, each
 * reading the endpoint it belongs to.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Ban, CheckCircle2, Clock3, FileText, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Invoices = Awaited<ReturnType<typeof api.finance>>;
type Renewals = Awaited<ReturnType<typeof api.renewals>>["renewals"];
type PrivacyRequests = Awaited<ReturnType<typeof api.privacyRequests>>["requests"];

function money(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "d MMM yyyy");
}

function StatusPill({ status }: { status: string }) {
  const tone =
    ["PAID", "FULFILLED", "CLOSED", "DONE"].includes(status)
      ? "bg-olive/15 text-olive-ink"
      : ["OVERDUE", "REJECTED", "FAILED", "CANCELLED"].includes(status)
        ? "bg-coral/15 text-coral-ink"
        : "bg-gold/15 text-gold-ink";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone)}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

export function AdminRecords() {
  const { t } = useI18n();
  const { session } = useApp();
  const isAdmin = session?.role === "ADMIN";

  const [invoices, setInvoices] = useState<Invoices | null>(null);
  const [renewals, setRenewals] = useState<Renewals | null>(null);
  const [requests, setRequests] = useState<PrivacyRequests | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const [f, r, p] = await Promise.allSettled([api.finance(), api.renewals(), api.privacyRequests()]);
    if (f.status === "fulfilled") setInvoices(f.value);
    if (r.status === "fulfilled") setRenewals(r.value.renewals);
    if (p.status === "fulfilled") setRequests(p.value.requests);
    if ([f, r, p].every((x) => x.status === "rejected")) {
      toast({ title: t("common.error"), description: t("records.loadFailed"), variant: "destructive" });
    }
    setLoading(false);
    setBusy(false);
  }, [t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function triage(id: string, status: string) {
    try {
      await api.triagePrivacyRequest(id, status);
      await load();
      toast({ title: t("records.triageSaved") });
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-5 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-gold-ink">{t("records.eyebrow")}</p>
          <h1 className="mt-1 font-editorial text-3xl text-cobble-ink">{t("records.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("records.subtitle")}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={busy} className="min-h-11">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {t("common.retry")}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <Tabs defaultValue="finance">
          <TabsList>
            <TabsTrigger value="finance">{t("records.tabFinance")}</TabsTrigger>
            <TabsTrigger value="renewals">{t("records.tabRenewals")}</TabsTrigger>
            <TabsTrigger value="privacy">{t("records.tabPrivacy")}</TabsTrigger>
          </TabsList>

          {/* ── Finance ── */}
          <TabsContent value="finance" className="mt-4 space-y-4">
            {invoices && (
              <div className="flex flex-wrap gap-3">
                <Metric label={t("records.mCount")} value={String(invoices.summary.count)} />
                <Metric label={t("records.mOpen")} value={money(invoices.summary.openCents, invoices.invoices[0]?.currency ?? "CHF")} />
                <Metric label={t("records.mPaid")} value={money(invoices.summary.paidCents, invoices.invoices[0]?.currency ?? "CHF")} />
              </div>
            )}
            {isAdmin && <InvoiceForm onCreated={load} />}
            <Table
              head={[t("records.colNumber"), t("records.colTitle"), t("records.colAmount"), t("records.colDue"), t("common.status")]}
              rows={(invoices?.invoices ?? []).map((i) => [
                <span key="n" className="font-mono text-xs">{i.number}</span>,
                <span key="t" className="font-medium text-cobble-ink">{i.title}</span>,
                money(i.amountCents, i.currency),
                day(i.dueAt),
                <StatusPill key="s" status={i.status} />,
              ])}
              empty={t("records.noInvoices")}
            />
          </TabsContent>

          {/* ── Renewals ── */}
          <TabsContent value="renewals" className="mt-4 space-y-4">
            {isAdmin && <RenewalForm onCreated={load} />}
            <Table
              head={[t("records.colTitle"), t("records.colKind"), t("records.colCase"), t("records.colDue"), t("common.status")]}
              rows={(renewals ?? []).map((r) => [
                <span key="t" className="font-medium text-cobble-ink">{r.title}</span>,
                <span key="k" className="text-xs uppercase tracking-wider text-muted-foreground">{r.kind.replace(/_/g, " ")}</span>,
                <span key="c" className="font-mono text-xs">{r.case?.reference ?? "—"}</span>,
                day(r.dueAt),
                <StatusPill key="s" status={r.status} />,
              ])}
              empty={t("records.noRenewals")}
            />
          </TabsContent>

          {/* ── Privacy requests ── */}
          <TabsContent value="privacy" className="mt-4 space-y-4">
            <section className="rounded-md border border-border bg-card p-5">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-gold-ink" aria-hidden />
                <h2 className="font-editorial text-lg text-cobble-ink">{t("records.privacyTitle")}</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t("records.privacyHint")}</p>
              <ul className="mt-3 divide-y divide-border">
                {(requests ?? []).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                    <span className="font-medium text-cobble-ink">{r.kind}</span>
                    <StatusPill status={r.status} />
                    <span className="text-muted-foreground">{day(r.createdAt)}</span>
                    {r.detail && <span className="w-full text-xs text-muted-foreground">{r.detail}</span>}
                    {isAdmin && r.status !== "FULFILLED" && r.status !== "REJECTED" && (
                      <span className="ml-auto flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => void triage(r.id, "FULFILLED")}>
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> {t("records.fulfil")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void triage(r.id, "REJECTED")}>
                          <Ban className="mr-1.5 h-3.5 w-3.5" /> {t("records.reject")}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
                {(requests ?? []).length === 0 && (
                  <li className="py-6 text-center text-sm text-muted-foreground">{t("records.noRequests")}</li>
                )}
              </ul>
            </section>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-editorial text-xl text-cobble-ink">{value}</p>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {cells.map((c, j) => (
                <td key={j} className="px-4 py-2.5 align-middle">{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-4 py-8 text-center text-muted-foreground">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Raise an invoice. Shown to ADMIN only — the endpoint requires `finance.write`. */
function InvoiceForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDays, setDueDays] = useState("30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .adminUsers()
      .then((r) => setClients(r.users.filter((u) => u.role === "CLIENT").map((u) => ({ id: u.id, name: u.name, email: u.email }))))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!clientId || !title.trim() || !Number.isFinite(cents) || cents <= 0) {
      toast({ title: t("records.invalidInvoice"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.createInvoice({
        clientId, title: title.trim(), amountCents: cents, dueDays: Math.max(1, Math.round(Number(dueDays) || 30)),
      });
      setTitle("");
      setAmount("");
      await onCreated();
      toast({ title: t("records.invoiceCreated") });
    } catch (err) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-border bg-card p-5">
      <div className="flex items-center gap-2.5">
        <FileText className="h-4 w-4 text-gold-ink" aria-hidden />
        <h2 className="font-editorial text-lg text-cobble-ink">{t("records.newInvoice")}</h2>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inv-client">{t("records.client")}</Label>
          <select
            id="inv-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("records.chooseClient")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-title">{t("records.colTitle")}</Label>
          <Input id="inv-title" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-amount">{t("records.amount")}</Label>
          <Input id="inv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-due">{t("records.dueInDays")}</Label>
          <Input id="inv-due" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} className="min-h-11" />
        </div>
        <div className="flex items-end sm:col-span-3">
          <Button type="submit" disabled={saving} className="min-h-11 bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("records.createInvoice")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Schedule an obligation. ADMIN only — the endpoint requires `renewal.write`. */
function RenewalForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [remindInDays, setRemindInDays] = useState("7");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueAt) {
      toast({ title: t("records.invalidRenewal"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.createRenewal({
        title: title.trim(),
        dueAt: new Date(dueAt).toISOString(),
        remindInDays: Math.max(0, Math.round(Number(remindInDays) || 7)),
      });
      setTitle("");
      setDueAt("");
      await onCreated();
      toast({ title: t("records.renewalCreated") });
    } catch (err) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-border bg-card p-5">
      <div className="flex items-center gap-2.5">
        <Clock3 className="h-4 w-4 text-gold-ink" aria-hidden />
        <h2 className="font-editorial text-lg text-cobble-ink">{t("records.newRenewal")}</h2>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ren-title">{t("records.colTitle")}</Label>
          <Input id="ren-title" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ren-due">{t("records.colDue")}</Label>
          <Input id="ren-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="min-h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ren-remind">{t("records.remindBefore")}</Label>
          <Input id="ren-remind" inputMode="numeric" value={remindInDays} onChange={(e) => setRemindInDays(e.target.value)} className="min-h-11" />
        </div>
        <div className="flex items-end sm:col-span-4">
          <Button type="submit" disabled={saving} className="min-h-11 bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("records.createRenewal")}
          </Button>
        </div>
      </div>
    </form>
  );
}
