/**
 * i18n barrel — one import site for every translated string.
 *
 * Client usage:
 *   const { t, locale, setLocale } = useI18n();
 *   t("nav.dashboard")
 *
 * Server usage (no hook):
 *   import { translate } from "@/lib/i18n";
 *   translate("de", "nav.dashboard")
 *
 * Keys are typed against the EN dictionary, so typos fail the build.
 * Missing keys in any locale fall back to English — locales can ship
 * progressively without runtime holes.
 */
"use client";

import { useSyncExternalStore } from "react";
import { EN, type Dict, type StringKey } from "./dictionaries/en";
import { DE } from "./dictionaries/de";
import { FR } from "./dictionaries/fr";
import { IT } from "./dictionaries/it";

export { EN, type Dict, type StringKey };
export const DICTIONARIES = { en: EN, de: DE, fr: FR, it: IT } as const;

export const LOCALES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

const isLocale = (v: string): v is Locale => LOCALES.some((l) => l.code === v);

/** Interpolate {{var}} placeholders. */
function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? `{{${k}}}`));
}

/** Translate a key in a locale (server-safe, falls back to EN). */
export function translate(locale: string, key: StringKey, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[isLocale(locale) ? locale : "en"] as Partial<Dict>;
  const raw = dict[key] ?? EN[key] ?? key;
  return fill(raw, vars);
}

// ── Tiny global store (no provider needed) ──

const STORE_KEY = "cl.locale";
let current: Locale = "en";
const listeners = new Set<() => void>();

/** Mirror the active locale onto <html lang> so screen readers pronounce
    the UI in the right language (was hardcoded to "en" in layout.tsx). */
function applyDocumentLang(locale: Locale) {
  try {
    if (globalThis.document !== undefined) document.documentElement.lang = locale;
  } catch {
    /* ignore */
  }
}

if (globalThis.window !== undefined) {
  try {
    const saved = window.localStorage.getItem(STORE_KEY);
    if (saved && isLocale(saved)) current = saved;
  } catch {
    /* private mode */
  }
  applyDocumentLang(current);
}

function setLocaleGlobal(locale: Locale) {
  current = locale;
  try {
    window.localStorage.setItem(STORE_KEY, locale);
  } catch {
    /* ignore */
  }
  applyDocumentLang(locale);
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => current;

/** Locale store — re-renders subscribed components on change. */
export function useI18nLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const locale = useSyncExternalStore(subscribe, getSnapshot, () => "en" as Locale);
  return { locale, setLocale: setLocaleGlobal };
}

/** The translate hook — `const { t } = useI18n()`. */
export function useI18n() {
  const { locale, setLocale } = useI18nLocale();
  return {
    locale,
    setLocale,
    t: (key: StringKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
  };
}
