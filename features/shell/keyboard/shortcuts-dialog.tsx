"use client";

/**
 * Keyboard shortcuts help overlay (U6 recognition > recall, U7 keyboard-first).
 *
 * Renders the registry from the pure domain module, grouped by category, with
 * platform-aware key labels. Opened with "?" from anywhere in the shell.
 */

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, type StringKey } from "@/lib/i18n";
import {
  DEFAULT_SHORTCUTS,
  formatShortcutForDisplay,
  groupShortcutsByCategory,
  type ShortcutCategory,
} from "./domain/shortcuts";
import { isMacPlatform } from "./adapters/useKeyboardShortcuts";

/** Category render order + heading keys. */
const CATEGORY_ORDER: ShortcutCategory[] = ["search", "navigation", "help"];

const CATEGORY_LABEL_KEYS: Record<ShortcutCategory, StringKey> = {
  search: "shortcuts.catSearch",
  navigation: "shortcuts.catNavigation",
  help: "shortcuts.catHelp",
};

/** Shortcut id → translated description. */
const SHORTCUT_LABEL_KEYS: Record<string, StringKey> = {
  search: "shortcuts.search",
  "nav-home": "shortcuts.navHome",
  "nav-cases": "shortcuts.navCases",
  "nav-crm": "shortcuts.navCrm",
  "nav-teams": "shortcuts.navTeams",
  "nav-settings": "shortcuts.navSettings",
  help: "shortcuts.help",
};

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const isMac = useMemo(() => isMacPlatform(), []);
  const groups = useMemo(() => groupShortcutsByCategory(DEFAULT_SHORTCUTS), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-editorial">{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {CATEGORY_ORDER.map((category) => {
            const items = groups[category];
            if (!items || items.length === 0) return null;
            return (
              <section key={category} aria-label={t(CATEGORY_LABEL_KEYS[category])}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t(CATEGORY_LABEL_KEYS[category])}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((shortcut) => (
                    <li key={shortcut.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-iron-ink">
                        {SHORTCUT_LABEL_KEYS[shortcut.id]
                          ? t(SHORTCUT_LABEL_KEYS[shortcut.id])
                          : shortcut.description}
                      </span>
                      <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-cobble-ink">
                        {formatShortcutForDisplay(shortcut, isMac)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
