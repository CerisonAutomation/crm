"use client";
/**
 * EntityPanel — reusable CRUD list/detail panel for admin entity models.
 * Driven by a column config so each model gets a functional UI without
 * 28 near-identical hand-written components.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Spinner, StateBadge } from "@/components/brand/ui";
import { Eyebrow, SectionTitle } from "@/components/brand/ui";
import { useApiData, LoadingBlock, ErrorBlock } from "@/components/brand/data-state";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCcw, Trash2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColumnDef<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
};

export type EntityAction<T> = {
  label: string;
  variant?: "default" | "destructive" | "outline";
  handler: (row: T) => void | Promise<void>;
  icon?: React.ReactNode;
};

export type EntityPanelProps<T extends { id: string }> = {
  title: string;
  eyebrow: string;
  fetchList: (qs?: Record<string, string>) => Promise<{ [key: string]: T[] }>;
  fetchOne?: (id: string) => Promise<{ [key: string]: T }>;
  createEntity?: (p: Record<string, unknown>) => Promise<{ [key: string]: T }>;
  updateEntity?: (id: string, p: Record<string, unknown>) => Promise<{ [key: string]: T }>;
  deleteEntity?: (id: string) => Promise<unknown>;
  columns: ColumnDef<T>[];
  createFields?: Array<{ name: string; label: string; type?: string; placeholder?: string; required?: boolean }>;
  detailFields?: Array<{ key: string; label: string }>;
  actions?: EntityAction<T>[];
  filterPlaceholder?: string;
  filterKey?: string;
  createTitle?: string;
  emptyMessage?: string;
};

export function EntityPanel<T extends { id: string }>({
  title,
  eyebrow,
  fetchList,
  fetchOne,
  createEntity,
  updateEntity,
  deleteEntity,
  columns,
  createFields,
  detailFields,
  actions,
  filterPlaceholder,
  filterKey = "q",
  createTitle,
  emptyMessage,
}: EntityPanelProps<T>) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<T | null>(null);
  const [showEdit, setShowEdit] = useState<T | null>(null);
  const [showDelete, setShowDelete] = useState<T | null>(null);
  const [createForm, setCreateForm] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const listKey = Object.keys({} as Awaited<ReturnType<typeof fetchList>>)[0] ?? "items";

  const { data, loading, error, reload } = useApiData(
    () => fetchList(filter ? { [filterKey]: filter } : undefined),
  );

  // Re-fetch when the filter changes (debounced). Skip the initial mount —
  // `useApiData` already loads once, so this only reacts to later changes.
  const filterMounted = useRef(false);
  useEffect(() => {
    if (!filterMounted.current) {
      filterMounted.current = true;
      return;
    }
    const timer = setTimeout(() => {
      void reload();
    }, 300);
    return () => clearTimeout(timer);
  }, [filter, reload]);

  const rows: T[] = data ? (data as Record<string, T[]>)[listKey] ?? [] : [];

  const handleCreate = useCallback(async () => {
    if (!createEntity) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of createFields ?? []) {
        payload[f.name] = createForm[f.name] ?? "";
      }
      await createEntity(payload);
      toast({ title: t("common.saved") });
      setShowCreate(false);
      setCreateForm({});
      reload();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : t("common.error"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [createEntity, createForm, createFields, t, reload]);

  const handleUpdate = useCallback(async () => {
    if (!updateEntity || !showEdit) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editForm)) {
        if (v !== "") payload[k] = v;
      }
      await updateEntity(showEdit.id, payload);
      toast({ title: t("common.saved") });
      setShowEdit(null);
      reload();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : t("common.error"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [updateEntity, showEdit, editForm, t, reload]);

  const handleDelete = useCallback(async () => {
    if (!deleteEntity || !showDelete) return;
    setSubmitting(true);
    try {
      await deleteEntity(showDelete.id);
      toast({ title: t("common.deleted") });
      setShowDelete(null);
      reload();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : t("common.error"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }, [deleteEntity, showDelete, t, reload]);

  const openDetail = useCallback((row: T) => {
    setShowDetail(row);
  }, []);

  const openEdit = useCallback((row: T) => {
    const form: Record<string, string> = {};
    for (const col of columns) {
      const val = (row as Record<string, unknown>)[col.key];
      if (val !== null && val !== undefined) form[col.key] = String(val);
    }
    setEditForm(form);
    setShowEdit(row);
  }, [columns]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <SectionTitle>{title}</SectionTitle>
        </div>
        <div className="flex items-center gap-2">
          {createEntity && (
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus className="h-4 w-4" />
              {t("common.create")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {filterPlaceholder && (
        <Input
          placeholder={filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
      )}

      <Card>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {emptyMessage ?? t("common.noData")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.key} className={col.className}>{col.header}</TableHead>
                ))}
                <TableHead className="w-24">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(row)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {updateEntity && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      {deleteEntity && (
                        <Button variant="ghost" size="sm" onClick={() => setShowDelete(row)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Create dialog */}
      {createEntity && createFields && (
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{createTitle ?? t("common.create")}</DialogTitle>
              <DialogDescription>{t("common.createDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {createFields.map((f) => (
                <div key={f.name} className="space-y-2">
                  <Label htmlFor={`create-${f.name}`}>{f.label}</Label>
                  <Input
                    id={`create-${f.name}`}
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    value={createForm[f.name] ?? ""}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting && <Spinner className="h-4 w-4" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Detail dialog */}
      {showDetail && (
        <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("common.details")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {(detailFields ?? columns.map((c) => ({ key: c.key, label: c.header }))).map((f) => (
                <div key={f.key} className="flex justify-between border-b pb-2">
                  <span className="text-sm font-medium">{f.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {String((showDetail as Record<string, unknown>)[f.key] ?? "—")}
                  </span>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetail(null)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit dialog */}
      {showEdit && updateEntity && (
        <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("common.edit")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {columns.map((col) => (
                <div key={col.key} className="space-y-2">
                  <Label htmlFor={`edit-${col.key}`}>{col.header}</Label>
                  <Input
                    id={`edit-${col.key}`}
                    value={editForm[col.key] ?? ""}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, [col.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEdit(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleUpdate} disabled={submitting}>
                {submitting && <Spinner className="h-4 w-4" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirmation */}
      {showDelete && deleteEntity && (
        <Dialog open={!!showDelete} onOpenChange={() => setShowDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("common.delete")}</DialogTitle>
              <DialogDescription>{t("common.deleteDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDelete(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
                {submitting && <Spinner className="h-4 w-4" />}
                {t("common.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
