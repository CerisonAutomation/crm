"use client";
/**
 * Citizen Lane — RM queue quick filters (Task 10-c)
 *
 * One-tap triage chips above the case queue list. Every count is derived
 * honestly from the fields the queue endpoint (GET /api/rm/cases) actually
 * exposes — nothing is faked:
 *
 *   · "All cases"        — every row in the current payload.
 *   · "Needs action"     — an RM decision is genuinely pending: the client-data
 *                          secondary approval is unmade (null/PENDING), or the
 *                          programme-choice approval is unmade while a programme
 *                          has been selected (mirrors RmCaseDetail's `decidable`
 *                          logic). Terminal cases (cancelled/completed) never
 *                          count. Document-review state is NOT derived here —
 *                          the queue payload carries only approved/total counts
 *                          and cannot distinguish "awaiting RM review" from
 *                          "awaiting client confirmation".
 *   · "Documents pending"— the case has open document requests awaiting the
 *                          client's upload (openRequests > 0).
 *
 *   · "Recent messages"  — deliberately OMITTED: the queue payload exposes no
 *                          message/recency signal, and inventing one from
 *                          `updatedAt` would be a guess. The key (rmq.filterMsg)
 *                          stays in the dictionaries for when the endpoint ships
 *                          a real lastMessageAt.
 *
 * Filtering itself is client-side over the already-loaded list, so a chip's
 * badge count always equals the length of the list the chip reveals.
 */

import { cn } from "@/lib/utils";
import type { StringKey } from "@/lib/i18n";

/** Structural subset of the rmCases queue row — keeps this module testable and decoupled. */
export type QueueFilterRow = {
  status: string;
  dataApproval: string | null;
  serviceApproval: string | null;
  programme: { name: string; country: string } | null;
  openRequests: number;
  updatedAt?: string;
};

export type QueueQuickKey = "ALL" | "ACTION" | "DOCS" | "RECENT";

/** Stages where no RM decision remains to be made. */
const TERMINAL_STATES = new Set(["CANCELLED", "COMPLETED"]);

/** An RM decision is genuinely pending on this case. */
export function caseNeedsAction(c: QueueFilterRow): boolean {
  if (TERMINAL_STATES.has(c.status)) return false;
  const dataPending = c.dataApproval === null || c.dataApproval === "PENDING";
  const servicePending = c.programme !== null && c.serviceApproval !== "APPROVED";
  return dataPending || servicePending;
}

/** Open document requests are awaiting the client's upload. */
export function caseDocsPending(c: QueueFilterRow): boolean {
  return c.openRequests > 0;
}

/** Case was updated within the last 7 days. */
export function caseRecentlyUpdated(c: QueueFilterRow): boolean {
  if (!c.updatedAt) return false;
  const updated = new Date(c.updatedAt);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return updated > weekAgo;
}

export function matchesQuickFilter(c: QueueFilterRow, filter: QueueQuickKey): boolean {
  if (filter === "ACTION") return caseNeedsAction(c);
  if (filter === "DOCS") return caseDocsPending(c);
  if (filter === "RECENT") return caseRecentlyUpdated(c);
  return true;
}

export function deriveQuickCounts(rows: QueueFilterRow[]): Record<QueueQuickKey, number> {
  return {
    ALL: rows.length,
    ACTION: rows.filter(caseNeedsAction).length,
    DOCS: rows.filter(caseDocsPending).length,
    RECENT: rows.filter(caseRecentlyUpdated).length,
  };
}

type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

const CHIPS: Array<{ key: QueueQuickKey; labelKey: StringKey }> = [
  { key: "ALL", labelKey: "rmq.filterAll" },
  { key: "ACTION", labelKey: "rmq.filterAction" },
  { key: "DOCS", labelKey: "rmq.filterDocs" },
  { key: "RECENT", labelKey: "rmq.filterRecent" },
];

/**
 * Chip row rendered above the queue list. ≥44px touch targets, wraps on
 * narrow screens, gold accent marks the active chip. Additive to the
 * existing search / status / "my cases" toolbar — never a replacement.
 */
export function QueueQuickFilters({
  active, onChange, counts, t,
}: {
  active: QueueQuickKey;
  onChange: (k: QueueQuickKey) => void;
  counts: Record<QueueQuickKey, number>;
  t: Translate;
}) {
  return (
    <div
      role="group"
      aria-label={t("rmq.filterAll")}
      className="flex flex-wrap items-center gap-2"
    >
      {CHIPS.map((chip) => {
        const isActive = active === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(chip.key)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition-colors",
              isActive
                ? "border-gold bg-gold/15 font-semibold text-cobble-ink shadow-[inset_0_1px_0_0_rgba(199,157,82,0.4)]"
                : "border-border bg-card text-iron-ink hover:border-gold/40 hover:bg-muted/40 hover:text-cobble-ink",
            )}
          >
            {t(chip.labelKey)}
            <span
              aria-label={`${counts[chip.key]}`}
              className={cn(
                "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none",
                isActive ? "bg-gold text-cobble-ink" : "bg-muted text-muted-foreground",
              )}
            >
              {counts[chip.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
