"use client";

/**
 * Status indicator with label and optional pulse animation.
 *
 * A more comprehensive status display than LiveDot, combining
 * a colored dot with a text label and optional pulse animation.
 */

import { cn } from "@/lib/utils";

const TONES = {
  olive: "bg-olive",
  gold: "bg-gold",
  coral: "bg-coral",
  sky: "bg-sky",
  neutral: "bg-muted-foreground",
} as const;

export function StatusIndicator({
  status,
  label,
  tone = "neutral",
  pulse = false,
  className,
}: {
  status?: string;
  label: string;
  tone?: keyof typeof TONES;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* Dots are decorative — the text label carries the status. */}
      <span className="relative inline-flex h-2 w-2" aria-hidden="true">
        {pulse && (
          <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping motion-reduce:animate-none", TONES[tone])} />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", TONES[tone])} />
      </span>
      <span className="text-sm text-iron-ink">{label}</span>
    </span>
  );
}
