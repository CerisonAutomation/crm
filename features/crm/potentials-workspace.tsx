"use client";

import { useCallback, useEffect, useState } from "react";
import { Target, Plus, Search, Trash2, Pencil, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDebouncedValue } from "@/hooks";
import { toast } from "@/hooks/use-toast";

type Potential = {
  id: string;
  potentialNo: string | null;
  name: string;
  opportunityType: string | null;
  stage: string | null;
  probability: number | null;
  amount: number | null;
  currency: string | null;
  closingDate: string | null;
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
};

const STAGES = ["Prospecting", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

export function PotentialsWorkspace() {
  // i18n available via useI18n if needed
  const [items, setItems] = useState<Potential[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Potential | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.potentials({ q: dq || undefined });
      setItems((res.potentials ?? []) as Potential[]);
    } catch (e) {
      toast({ title: "Failed to load potentials", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [dq]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this potential?")) return;
    try {
      await api.deletePotential(id);
      toast({ title: "Potential deleted" });
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Target className="h-5 w-5" /> Potentials
        </h2>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Potential
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search potentials..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="grid gap-3">
        {items.map((p) => (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{p.name} {p.potentialNo && <span className="text-xs text-muted-foreground ml-2">({p.potentialNo})</span>}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div>Stage: {p.stage ?? "—"} · Probability: {p.probability ?? 0}% · Amount: {p.amount ?? 0} {p.currency ?? "EUR"}</div>
              {p.account && <div>Account: {p.account.name}</div>}
              {p.contact && <div>Contact: {p.contact.name}</div>}
              {p.closingDate && <div>Closing: {new Date(p.closingDate).toLocaleDateString()}</div>}
            </CardContent>
          </Card>
        ))}
        {!loading && items.length === 0 && <div className="text-center py-8 text-muted-foreground">No potentials found.</div>}
      </div>

      {(creating || editing) && (
        <PotentialForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function PotentialForm({ initial, onClose, onSaved }: { initial: Potential | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [stage, setStage] = useState(initial?.stage ?? "Prospecting");
  const [probability, setProbability] = useState(String(initial?.probability ?? 0));
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [opportunityType, setOpportunityType] = useState(initial?.opportunityType ?? "");
  const [leadsource, setLeadsource] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { name, stage, probability: Number(probability), amount: amount ? Number(amount) : null, currency, opportunityType, leadsource, description };
      if (initial) await api.updatePotential(initial.id, body);
      else await api.createPotential(body);
      toast({ title: initial ? "Potential updated" : "Potential created" });
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader><CardTitle>{initial ? "Edit Potential" : "New Potential"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="w-full border rounded px-3 py-2 text-sm" value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Input placeholder="Opportunity Type" value={opportunityType} onChange={(e) => setOpportunityType(e.target.value)} />
          <Input placeholder="Lead Source" value={leadsource} onChange={(e) => setLeadsource(e.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Probability %" type="number" value={probability} onChange={(e) => setProbability(e.target.value)} />
            <Input placeholder="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input placeholder="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24" />
          </div>
          <textarea className="w-full border rounded px-3 py-2 text-sm" rows={3} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
