"use client";
/**
 * Locale switcher — extracted from app-shell so lightweight surfaces
 * (landing, login) don't pull the entire authenticated shell graph
 * (studio, consoles, builders) into their bundle. Rendered identically.
 */
import { useI18n, LOCALES } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact locale switcher — Globe + current code, options in their native labels. */
export function LocaleSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-10 gap-1.5 rounded-full px-2.5",
            tone === "dark"
              ? "text-[#B9C4CE] hover:text-[#F5F1EA] hover:bg-[#16324A]"
              : "text-iron-ink hover:bg-muted hover:text-cobble-ink",
          )}
          aria-label={t("common.changeLanguage")}
          title={t("common.changeLanguage")}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t("common.language")}
        </DropdownMenuLabel>
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            className={cn("cursor-pointer justify-between", l.code === locale && "bg-muted/50")}
            onSelect={() => setLocale(l.code)}
          >
            {l.label}
            {l.code === locale && <Check className="h-3.5 w-3.5 text-gold-ink" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
