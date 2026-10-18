"use client";

/**
 * CrmViewSwitcher — configurable RM / admin queue views.
 *
 * SYSTEM views ship with the product; ORG views are saved by admins and
 * PERSONAL views by individual RMs. This switcher is presentational: it lists
 * the available definitions and reports selection + new-view labels upward, so
 * persistence (and its capability gates) stays in the route layer. View counts
 * are supplied by the parent, which derives them from the same rows the view
 * reveals — a badge always equals the length of the list it opens.
 */

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CrmViewDef } from "@/features/rm/crm-projections";

export function CrmViewSwitcher({
  views,
  activeKey,
  counts,
  canManage,
  onSelect,
  onSaveView,
}: {
  views: CrmViewDef[];
  activeKey: string;
  counts?: Record<string, number>;
  canManage: boolean;
  onSelect: (key: string) => void;
  onSaveView?: (label: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Saved queue views">
        {views.map((view) => {
          const active = view.key === activeKey;
          const count = counts?.[view.key];
          return (
            <button
              key={view.key}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(view.key)}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                active
                  ? "border-gold bg-gold/10 font-semibold text-cobble-ink"
                  : "border-border bg-card text-iron-ink hover:bg-muted/40",
              )}
            >
              {view.label}
              {typeof count === "number" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
              )}
              {view.scope !== "SYSTEM" && (
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{view.scope}</span>
              )}
            </button>
          );
        })}
      </div>
      {canManage && (
        <div className="flex items-center gap-2">
          {saving ? (
            <>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Name this view — e.g. My high-risk queue"
                aria-label="New view name"
                className="h-11 max-w-xs"
              />
              <Button
                size="sm"
                className="min-h-[44px]"
                disabled={draft.trim().length === 0}
                onClick={() => {
                  onSaveView?.(draft.trim());
                  setDraft("");
                  setSaving(false);
                }}
              >
                Save view
              </Button>
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setSaving(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setSaving(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Save current filters as a view
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
