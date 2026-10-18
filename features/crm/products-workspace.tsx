"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, Plus, Search, Trash2, Pencil, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDebouncedValue } from "@/hooks";
import { toast } from "@/hooks/use-toast";

type Product = {
  id: string;
  productCode: string | null;
  productName: string;
  category: string | null;
  manufacturer: string | null;
  unitPrice: number | null;
  currency: string | null;
  quantityInStock: number | null;
  isActive: boolean;
};

export function ProductsWorkspace() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.products({ q: dq || undefined });
      setItems((res.products ?? []) as Product[]);
    } catch (e) {
      toast({ title: "Failed to load products", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [dq]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    try {
      await api.deleteProduct(id);
      toast({ title: "Product deleted" });
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Package className="h-5 w-5" /> Products
        </h2>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Product
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search products..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="grid gap-3">
        {items.map((p) => (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{p.productName} {p.productCode && <span className="text-xs text-muted-foreground ml-2">({p.productCode})</span>}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div>Category: {p.category ?? "—"} · Price: {p.unitPrice ?? 0} {p.currency ?? "EUR"} · Stock: {p.quantityInStock ?? 0}</div>
              {p.manufacturer && <div>Manufacturer: {p.manufacturer}</div>}
              <div>Status: {p.isActive ? "Active" : "Inactive"}</div>
            </CardContent>
          </Card>
        ))}
        {!loading && items.length === 0 && <div className="text-center py-8 text-muted-foreground">No products found.</div>}
      </div>

      {(creating || editing) && (
        <ProductForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProductForm({ initial, onClose, onSaved }: { initial: Product | null; onClose: () => void; onSaved: () => void }) {
  const [productName, setProductName] = useState(initial?.productName ?? "");
  const [productCode, setProductCode] = useState(initial?.productCode ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [unitPrice, setUnitPrice] = useState(String(initial?.unitPrice ?? ""));
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [quantityInStock, setQuantityInStock] = useState(String(initial?.quantityInStock ?? 0));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!productName.trim()) { toast({ title: "Product name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { productName, productCode: productCode || undefined, category, manufacturer, unitPrice: unitPrice ? Number(unitPrice) : null, currency, quantityInStock: Number(quantityInStock), description };
      if (initial) await api.updateProduct(initial.id, body);
      else await api.createProduct(body);
      toast({ title: initial ? "Product updated" : "Product created" });
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
        <CardHeader><CardTitle>{initial ? "Edit Product" : "New Product"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Product Name *" value={productName} onChange={(e) => setProductName(e.target.value)} />
          <Input placeholder="Product Code" value={productCode} onChange={(e) => setProductCode(e.target.value)} />
          <Input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input placeholder="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Unit Price" type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            <Input placeholder="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24" />
            <Input placeholder="Stock" type="number" value={quantityInStock} onChange={(e) => setQuantityInStock(e.target.value)} className="w-24" />
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
