"use client";

/**
 * Character counter for text inputs.
 *
 * Shows current character count and optional max limit.
 * Changes color when approaching or exceeding the limit.
 */

import { cn } from "@/lib/utils";

export function CharacterCounter({
  current,
  max,
  className,
}: {
  current: number;
  max?: number;
  className?: string;
}) {
  const nearLimit = max != null && current >= max * 0.9;
  const overLimit = max != null && current > max;

  const announcement = max != null ? `${current} of ${max} characters${overLimit ? ", over limit" : ""}` : `${current} characters`;
  return (
    <span
      role="status"
      aria-label={announcement}
      className={cn(
        "text-xs tabular-nums",
        overLimit ? "text-danger-ink font-semibold" : nearLimit ? "text-amber-ink" : "text-muted-foreground",
        className,
      )}
    >
      {current}
      {max != null && ` / ${max}`}
    </span>
  );
}
