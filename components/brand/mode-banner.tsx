"use client";

import { FlaskConical, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModeBannerProps {
  mode: "SANDBOX" | "PRODUCTION";
  className?: string;
}

/**
 * Mode banner — thin strip showing whether the platform is in sandbox
 * or production mode (trust decor E17).
 */
export function ModeBanner({ mode, className }: ModeBannerProps) {
  const isSandbox = mode === "SANDBOX";
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em]",
        isSandbox
          ? "bg-amber-500/15 text-amber-800"
          : "bg-emerald-500/15 text-emerald-800",
        className,
      )}
      role="status"
    >
      {isSandbox ? (
        <FlaskConical className="h-3.5 w-3.5" />
      ) : (
        <Rocket className="h-3.5 w-3.5" />
      )}
      {isSandbox ? "Sandbox mode — no real data" : "Production"}
    </div>
  );
}