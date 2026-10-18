"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Search, Trash2, Pencil, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import { toast } from "@/hooks/use-toast";

type Account = {
  id: string;
  accountNo: string | null;
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  industry: string | null;
  type: string | null;
  ownerId: string | null;
  createdAt: string;
};

export function AccountsWorkspace() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ name: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.accounts({ q: dq });
      setAccounts((res.accounts ?? []) as Account[]);
    } catch (error) {
      toast({ title: t("common.error"), description: error instanceof Error ? error.message : "Could not load accounts.", variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dq, t]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!form.name?.trim()) {
      toast({ title: "Validation", description: "Account name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateAccount(editing.id, form);
        toast({ title: "Account updated" });
      } else {
        await api.createAccount(form);
        toast({ title: "Account created" });
      }
      setShowForm(false);
      setEditing(null);
      setForm({ name: "" });
      await load(true);
    } catch (error) {
      toast({ title: t("common.error"), description: error instanceof Error ? error.message : "Could not save account.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this account?")) return;
    try {
      await api.deleteAccount(id);
      toast({ title: "Account deleted" });
      await load(true);
    } catch (error) {
      toast({ title: t("common.error"), description: error instanceof Error ? error.message : "Could not delete account.", variant: "destructive" });
    }
  }

  function startEdit(acc: Account) {
    setEditing(acc);
    setForm({
      name: acc.name,
      website: acc.website ?? "",
      phone: acc.phone ?? "",
      email: acc.email ?? "",
      billingCity: acc.billingCity ?? "",
      industry: acc.industry ?? "",
      type: acc.type ?? "",
    });
    setShowForm(true);
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-ink">CRM⁺ Accounts</p>
          <h1 className="mt-2 font-editorial text-3xl text-cobble-ink md:text-4xl">Accounts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Organisations and companies tracked by the desk.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load(true)} disabled={refreshing} className="min-h-11">
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button onClick={() => { setEditing(null); setForm({ name: "" }); setShowForm(true); }} className="min-h-11">
            <Plus className="mr-2 h-4 w-4" /> New Account
          </Button>
        </div>
      </header>

      <div className="mt-6 relative w-full sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts..." className="min-h-11 pl-9" />
      </div>

      {showForm && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{editing ? "Edit Account" : "New Account"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { key: "name", label: "Account Name *", required: true },
                { key: "website", label: "Website" },
                { key: "phone", label: "Phone" },
                { key: "email", label: "Email" },
                { key: "billingCity", label: "Billing City" },
                { key: "industry", label: "Industry" },
                { key: "type", label: "Type" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <Input
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="mt-1 min-h-11"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editing ? "Update" : "Create"}
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((acc) => (
          <Card key={acc.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-ink">
                  <Building2 className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-medium text-cobble-ink">{acc.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {acc.accountNo} · {acc.billingCity ?? acc.billingCountry ?? "—"}
                  </p>
                  {acc.phone && <p className="truncate text-xs text-muted-foreground mt-1">{acc.phone}</p>}
                  {acc.website && <p className="truncate text-xs text-muted-foreground">{acc.website}</p>}
                  {acc.email && <p className="truncate text-xs text-muted-foreground">{acc.email}</p>}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => startEdit(acc)}>
                  <Pencil className="mr-1 h-3 w-3" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => void remove(acc.id)}>
                  <Trash2 className="mr-1 h-3 w-3" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && accounts.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border px-5 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">No accounts found</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Create your first account to get started.</p>
        </div>
      )}
    </main>
  );
}
