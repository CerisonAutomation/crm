"use client";

import { useState, useCallback, useRef, useEffect, useId } from "react";
import { MapPin, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────

export interface MaltaAddress {
  street: string;
  city: string;
  postcode: string;
  locality: string;
  region: string;
  country: string;
  lat?: number;
  lng?: number;
  formatted: string;
}

interface MaltaAddressAutocompleteProps {
  onSelect: (address: MaltaAddress) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  value?: string;
  id?: string;
  name?: string;
  /** Visible label — rendered above the field and wired via htmlFor. */
  label?: string;
}

// ─── Malta Localities Database ─────────────────────────────────────

const MALTA_LOCALITIES: Array<{ name: string; postcode: string; region: string }> = [
  { name: "Valletta", postcode: "VLT", region: "South Harbour" },
  { name: "Sliema", postcode: "SLM", region: "North Harbour" },
  { name: "St. Julian's", postcode: "STJ", region: "North Harbour" },
  { name: "Birkirkara", postcode: "BKR", region: "Central" },
  { name: "Mosta", postcode: "MST", region: "Northern" },
  { name: "Qormi", postcode: "QRM", region: "Southern" },
  { name: "Żabbar", postcode: "ZAB", region: "South Harbour" },
  { name: "Marsa", postcode: "MSA", region: "South Harbour" },
  { name: "Paola", postcode: "PLA", region: "South Harbour" },
  { name: "Tarxien", postcode: "TXN", region: "South Harbour" },
  { name: "Fgura", postcode: "FGR", region: "South Harbour" },
  { name: "Żejtun", postcode: "ZTN", region: "South East" },
  { name: "Gżira", postcode: "GZR", region: "North Harbour" },
  { name: "Pembroke", postcode: "PBK", region: "Northern" },
  { name: "Swieqi", postcode: "SQW", region: "Northern" },
  { name: "San Ġwann", postcode: "SGW", region: "Northern" },
  { name: "San Pawl il-Baħar", postcode: "SPB", region: "Northern" },
  { name: "Mellieħa", postcode: "MLH", region: "Northern" },
  { name: "Rabat", postcode: "RBT", region: "Western" },
  { name: "Mdina", postcode: "MDN", region: "Western" },
  { name: "Dingli", postcode: "DGL", region: "Western" },
  { name: "Siġġiewi", postcode: "SGW", region: "Western" },
  { name: "Attard", postcode: "ATD", region: "Western" },
  { name: "Lija", postcode: "LJA", region: "Western" },
  { name: "Balzan", postcode: "BLZ", region: "Western" },
  { name: "Naxxar", postcode: "NXR", region: "Northern" },
  { name: "Għargħur", postcode: "GHR", region: "Northern" },
  { name: "St. Paul's Bay", postcode: "SPB", region: "Northern" },
  { name: "Bugibba", postcode: "BGB", region: "Northern" },
  { name: "Qawra", postcode: "QWR", region: "Northern" },
  { name: "Marsaskala", postcode: "MSK", region: "South East" },
  { name: "Marsaxlokk", postcode: "MXK", region: "South East" },
  { name: "Birżebbuġa", postcode: "BBG", region: "South East" },
  { name: "Żurrieq", postcode: "ZRQ", region: "Southern" },
  { name: "Qrendi", postcode: "QRD", region: "Southern" },
  { name: "Mġarr", postcode: "MGR", region: "Northern" },
  { name: "Gozo - Victoria", postcode: "VCT", region: "Gozo" },
  { name: "Gozo - Xagħra", postcode: "XAG", region: "Gozo" },
  { name: "Gozo - Nadur", postcode: "NDR", region: "Gozo" },
  { name: "Gozo - Għajnsielem", postcode: "GJS", region: "Gozo" },
  { name: "Gozo - Qala", postcode: "QLA", region: "Gozo" },
  { name: "Gozo - Kerċem", postcode: "KCM", region: "Gozo" },
  { name: "Gozo - Munxar", postcode: "MNX", region: "Gozo" },
  { name: "Gozo - Sannat", postcode: "SNT", region: "Gozo" },
  { name: "Gozo - Xewkija", postcode: "XWK", region: "Gozo" },
  { name: "Gozo - Żebbuġ", postcode: "ZBG", region: "Gozo" },
];

// ─── Nominatim API (OpenStreetMap) ─────────────────────────────────

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

async function searchNominatim(query: string): Promise<MaltaAddress[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=mt&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) return [];
    const data: NominatimResult[] = await res.json();
    return data.map((item) => ({
      street: item.display_name.split(",")[0] || "",
      city: item.display_name.split(",")[1]?.trim() || "",
      postcode: "",
      locality: item.display_name.split(",")[1]?.trim() || "",
      region: "",
      country: "Malta",
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      formatted: item.display_name,
    }));
  } catch {
    return [];
  }
}

// ─── Component ─────────────────────────────────────────────────────

export function MaltaAddressAutocomplete({
  onSelect,
  placeholder = "Start typing an address…",
  className,
  disabled,
  value,
  id,
  name,
  label,
}: MaltaAddressAutocompleteProps) {
  // Unique listbox/option ids — the previous hardcoded ids collided when two
  // address fields shared a page, breaking aria-controls/activedescendant.
  const uid = useId();
  const inputId = id ?? `malta-address-${uid}`;
  const listboxId = `malta-address-listbox-${uid}`;
  const optionId = (i: number) => `malta-address-option-${uid}-${i}`;
  const [input, setInput] = useState(value ?? "");
  const [suggestions, setSuggestions] = useState<MaltaAddress[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync external value. Compared against the last synced prop (not against
  // `input`) so typing is never clobbered by a parent re-render, and adjusted
  // during render so the new value lands on the next paint.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== undefined) setInput(value);
  }

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const search = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Search local Malta localities first
      const localResults = MALTA_LOCALITIES.filter(
        (loc) =>
          loc.name.toLowerCase().includes(query.toLowerCase()) ||
          loc.postcode.toLowerCase().includes(query.toLowerCase())
      ).map((loc) => ({
        street: "",
        city: loc.name,
        postcode: loc.postcode,
        locality: loc.name,
        region: loc.region,
        country: "Malta",
        formatted: `${loc.name}, ${loc.postcode}, Malta`,
      }));

      // Also search Nominatim for street-level results
      const nominatimResults = await searchNominatim(query);

      // Merge and deduplicate
      const allResults = [...localResults, ...nominatimResults];
      const seen = new Set<string>();
      const unique = allResults.filter((addr) => {
        const key = `${addr.street}-${addr.city}-${addr.postcode}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setSuggestions(unique.slice(0, 8));
      setIsOpen(unique.length > 0);
      setHighlightedIndex(-1);
    } catch {
      setError("Address search unavailable");
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (address: MaltaAddress) => {
    setInput(address.formatted);
    setIsOpen(false);
    setSuggestions([]);
    onSelect(address);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSelect(suggestions[highlightedIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label && <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-cobble-ink">{label}</label>}
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => input.length >= 2 && suggestions.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive focus-visible:ring-destructive"
          )}
        />
        {isLoading && (
          <span role="status" className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Searching addresses…</span>
          </span>
        )}
      </div>

      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}

      {isOpen && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label ?? placeholder}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((addr, idx) => (
            <li
              key={`${addr.street}-${addr.city}-${addr.postcode}-${idx}`}
              id={optionId(idx)}
              role="option"
              aria-selected={idx === highlightedIndex}
              onClick={() => handleSelect(addr)}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm",
                idx === highlightedIndex && "bg-accent text-accent-foreground"
              )}
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{addr.street || addr.locality}</p>
                {addr.city && (
                  <p className="truncate text-xs text-muted-foreground">
                    {addr.city}
                    {addr.postcode && `, ${addr.postcode}`}
                    {addr.country && `, ${addr.country}`}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
