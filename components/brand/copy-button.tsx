"use client";

/**
 * Copy to clipboard button.
 *
 * Copies text to clipboard with visual feedback.
 * Shows a checkmark briefly after successful copy.
 */

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex min-h-6 min-w-6 items-center justify-center gap-1.5 rounded p-1 text-xs text-muted-foreground hover:text-iron-ink transition-colors",
        className,
      )}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-olive" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {label && <span>{copied ? "Copied" : label}</span>}
      <span className="sr-only" role="status">{copied ? "Copied to clipboard" : ""}</span>
    </button>
  );
}
