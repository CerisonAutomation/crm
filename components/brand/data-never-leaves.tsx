"use client";

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataNeverLeavesProps {
  feature?: string;
  className?: string;
}

/**
 * E17 data-never-leaves banner — static, presentational, always visible.
 *
 * The E17 promise (on-device first, cloud only with consent and redaction)
 * plus the on-device note. Cobble ground with a gold hairline and limestone
 * ink — on-palette tokens only. Copy mirrors the per-feature AI disclosure
 * source (see src/lib/ai/disclosure.ts) without importing it, so this
 * primitive stays presentational.
 */
export function DataNeverLeaves({ feature, className }: DataNeverLeavesProps) {
  return (
    <div
      role="note"
      aria-label={
        feature
          ? `Data never leaves this device — ${feature}`
          : "Data never leaves this device"
      }
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-gold/40 bg-cobble px-3.5 py-2.5",
        className
      )}
    >
      <ShieldCheck
        className="mt-0.5 h-4 w-4 shrink-0 text-gold"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-limestone">
          Your data never leaves this device{feature ? ` — ${feature}` : ""}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-limestone/80">
          On-device AI runs here in your browser — nothing is uploaded. Cloud
          answers run only with your consent, with personal details stripped
          first.
        </p>
      </div>
    </div>
  );
}
