"use client";

import { useCallback, useEffect, useState } from "react";
import { ShoppingCart, Plus, Search, Trash2, Pencil, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDebouncedValue } from "@/hooks";
import { toast } from "@/hooks/use-toast";

type SalesOrder = {
  id: string;
  salesOrderNo: string | null;
  subject: string;
  status: string | null;
  total: number | null;
  currency: string | null;
  dueDate: string | null;
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
};

export function SalesOrdersWorkspace() {
  const [items, setItems] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.salesOrders({ q: dq || undefined });
      setItems((res.salesOrders ?? []) as SalesOrder[]);
    } catch (e) {
      toast({ title: "Failed to load sales orders", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [dq]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this sales order?")) return;
    try {
      await api.deleteSalesOrder(id);
      toast({ title: "Sales order deleted" });
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" /> Sales Orders
        </h2>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Sales Order
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search sales orders..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="grid gap-3">
        {items.map((s) => (
          <Card key={s.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{s.subject} {s.salesOrderNo && <span className="text-xs text-muted-foreground ml-2">({s.salesOrderNo})</span>}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div>Status: {s.status ?? "—"} · Total: {s.total ?? 0} {s.currency ?? "EUR"}</div>
              {s.account && <div>Account: {s.account.name}</div>}
              {s.contact && <div>Contact: {s.contact.name}</div>}
              {s.dueDate && <div>Due: {new Date(s.dueDate).toLocaleDateString()}</div>}
            </CardContent>
          </Card>
        ))}
        {!loading && items.length === 0 && <div className="text-center py-8 text-muted-foreground">No sales orders found.</div>}
      </div>

      {(creating || editing) && (
        <SalesOrderForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function SalesOrderForm({ initial, onClose, onSaved }: { initial: SalesOrder | null; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [status, setStatus] = useState(initial?.status ?? "Draft");
  const [total, setTotal] = useState(String(initial?.total ?? ""));
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!subject.trim()) { toast({ title: "Subject required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { subject, status, total: total ? Number(total) : null, currency, description };
      if (initial) await api.updateSalesOrder(initial.id, body);
      else await api.createSalesOrder(body);
      toast({ title: initial ? "Sales order updated" : "Sales order created" });
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
        <CardHeader><CardTitle>{initial ? "Edit Sales Order" : "New Sales Order"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Subject *" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <select className="w-full border rounded px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["Draft", "Approved", "Delivered", "Cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex gap-2">
            <Input placeholder="Total" type="number" value={total} onChange={(e) => setTotal(e.target.value)} />
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
