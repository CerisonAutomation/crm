"use client";

/**
 * Tooltip component.
 *
 * A lightweight, accessible tooltip that appears on hover and focus.
 * Uses native `title` as fallback but provides a styled overlay.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  const positions = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 px-2 py-1 text-xs font-medium text-[#F5F1EA] bg-cobble rounded shadow-lg whitespace-nowrap pointer-events-none",
            positions[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
