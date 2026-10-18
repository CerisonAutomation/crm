"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface TrustBadgeProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  variant?: "compact" | "detailed";
  className?: string;
}

export function TrustBadge({ icon: Icon, title, description, variant = "detailed", className }: TrustBadgeProps) {
  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Icon className="h-4 w-4 text-gold-ink" aria-hidden="true" />
        <span>{title}</span>
      </div>
    );
  }

  return (
    // min-w-0 + anywhere-wrapping: a single unbreakable token (raw i18n key,
    // programme name, URL) must wrap instead of forcing the grid track — and
    // the page — wider than the viewport. No visual effect on normal copy.
    <div className={cn("group card-lift min-w-0", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded border border-limestone bg-muted text-gold-ink mb-4 transition-colors group-hover:border-gold group-hover:bg-gold/10">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="font-editorial type-h3 text-cobble-ink [overflow-wrap:anywhere]">{title}</h3>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-iron-ink [overflow-wrap:anywhere]">{description}</p>
      )}
    </div>
  );
}
