"use client";

/**
 * RoleTiles — FS-7 welcome + checklist tiles per ApplicantRole.
 *
 * The primary track (profile → identity → funds → programme → review) is
 * always present; dependant roles add their own required documents (spouse
 * police record, child birth certificate, parent dependency proof …) via
 * roleTilesFor(). Tiles are real buttons (keyboard-reachable, ≥44px) and
 * report upward — navigation stays with the parent.
 */

import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleTilesFor } from "@/features/rm/crm-projections";

export function RoleTiles({
  role,
  doneKeys = [],
  onOpen,
  className,
}: {
  role: string;
  doneKeys?: string[];
  onOpen?: (tileKey: string) => void;
  className?: string;
}) {
  const tiles = roleTilesFor(role);
  const done = new Set(doneKeys);
  const completed = tiles.filter((t) => done.has(t.key)).length;

  return (
    <section aria-label={`Checklist for ${role}`} className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-cobble-ink">Your checklist</h3>
        <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {completed} of {tiles.length} complete
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {tiles.map((tile) => {
          const isDone = done.has(tile.key);
          return (
            <li key={tile.key}>
              <button
                onClick={() => onOpen?.(tile.key)}
                aria-label={`${tile.title}${isDone ? " (complete)" : ""}${tile.required ? "" : " (optional)"}`}
                className={cn(
                  "flex min-h-[44px] w-full items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/30",
                  isDone && "border-olive/40 bg-olive/5",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    isDone ? "border-olive bg-olive text-white" : "border-border text-transparent",
                  )}
                >
                  <Check className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-cobble-ink">
                    {tile.title}
                    {!tile.required && <span className="ml-1.5 font-normal text-muted-foreground">optional</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{tile.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
