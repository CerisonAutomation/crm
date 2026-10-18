"use client";

/**
 * Debounced search input.
 *
 * A search input that debounces the onChange callback to avoid
 * excessive API calls while typing.
 */

import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({
  onSearch,
  placeholder = "Search…",
  debounceMs = 300,
  className,
  defaultValue,
}: {
  onSearch: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs, onSearch]);

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute right-1.5 top-1/2 inline-flex h-6 min-h-6 w-6 min-w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-iron-ink"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
