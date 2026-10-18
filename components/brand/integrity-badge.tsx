"use client";

import { ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IntegrityBadgeProps {
  ok: boolean;
  checked?: number;
  mismatches?: number;
  className?: string;
}

/**
 * Integrity badge — shows the hash-chain verification status of the
 * append-only CaseEvent ledger (spec §2 / R2, trust decor E16).
 */
export function IntegrityBadge({ ok, checked, mismatches, className }: IntegrityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
          : "border-red-500/30 bg-red-500/10 text-red-700",
        className,
      )}
      title={
        ok
          ? `Case event chain verified (${checked ?? 0} events)`
          : `Chain integrity failure: ${mismatches ?? "?"} mismatch(es)`
      }
    >
      {ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      {ok ? "Chain verified" : "Chain broken"}
    </span>
  );
}