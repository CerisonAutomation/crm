"use client";
/**
 * Preferences — the ONE store for how the app presents itself to a person.
 *
 * Two jobs, one file:
 *
 * 1. **Experience mode.** `simple` hides the tooling (builders, raw ids,
 *    technical panels) and speaks in plain words; `advanced` shows everything.
 *    Nothing is removed in simple mode — it is collapsed, so the full detail
 *    stays reachable and editable. A client defaults to simple, staff to
 *    advanced; an explicit choice always wins and persists.
 *
 * 2. **Appearance & accessibility.** Theme, text size, density, reduced motion
 *    and high contrast. These were previously either voice-only (theme) or
 *    fixed in code, so nothing here existed as a setting before.
 *
 * Same shape as the i18n store: a tiny module-level store read through
 * `useSyncExternalStore`, no provider, safe to import from anywhere. The apply
 * step writes `<html>` attributes only — globals.css owns every visual rule, so
 * a preference can never desync from the CSS that reads it.
 */

import { useSyncExternalStore } from "react";

export type UiMode = "simple" | "advanced";
export type ThemeChoice = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type TextSize = "default" | "large" | "xlarge";

export type Preferences = {
  /** `null` = not chosen yet — resolve per role (see `resolveMode`). */
  mode: UiMode | null;
  theme: ThemeChoice;
  density: Density;
  textSize: TextSize;
  reduceMotion: boolean;
  highContrast: boolean;
};

const PREFS_KEY = "cl.prefs";
/** Legacy key written before preferences existed; still honoured on read. */
const LEGACY_THEME_KEY = "cl.theme";

export const DEFAULT_PREFERENCES: Preferences = {
  mode: null,
  theme: "light",
  density: "comfortable",
  textSize: "default",
  reduceMotion: false,
  highContrast: false,
};

/** Simple by default for clients, advanced for staff, until someone chooses. */
function resolveMode(mode: UiMode | null, role: string | null | undefined): UiMode {
  if (mode) return mode;
  return role === "CLIENT" ? "simple" : "advanced";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const MODES: UiMode[] = ["simple", "advanced"];
const THEMES: ThemeChoice[] = ["light", "dark", "system"];
const DENSITIES: Density[] = ["comfortable", "compact"];
const TEXT_SIZES: TextSize[] = ["default", "large", "xlarge"];

/**
 * Coerce anything (stored JSON, a server value, a partial patch) into a valid
 * full `Preferences`. Unknown or malformed fields fall back to the default, so
 * a corrupt entry can never break the app — it degrades to canon.
 */
function normalizePreferences(raw: unknown): Preferences {
  const src = isRecord(raw) ? raw : {};
  const mode = MODES.includes(src.mode as UiMode) ? (src.mode as UiMode) : null;
  return {
    mode,
    theme: THEMES.includes(src.theme as ThemeChoice) ? (src.theme as ThemeChoice) : DEFAULT_PREFERENCES.theme,
    density: DENSITIES.includes(src.density as Density) ? (src.density as Density) : DEFAULT_PREFERENCES.density,
    textSize: TEXT_SIZES.includes(src.textSize as TextSize) ? (src.textSize as TextSize) : DEFAULT_PREFERENCES.textSize,
    reduceMotion: src.reduceMotion === true,
    highContrast: src.highContrast === true,
  };
}

/** Read persisted preferences (never throws; private mode yields defaults). */
export function readPreferences(): Preferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) return normalizePreferences(JSON.parse(raw));
    // Migrate a pre-existing theme choice so nobody loses their dark mode.
    const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === "dark" || legacy === "light") {
      return { ...DEFAULT_PREFERENCES, theme: legacy };
    }
  } catch {
    /* private mode / blocked storage */
  }
  return { ...DEFAULT_PREFERENCES };
}

/** Does the OS ask for dark right now? (Only consulted for `theme: "system"`.) */
function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme actually painted for a preference (resolves `system`). */
function resolvedTheme(prefs: Preferences): "light" | "dark" {
  if (prefs.theme === "system") return systemPrefersDark() ? "dark" : "light";
  return prefs.theme;
}

/**
 * Write a preference set onto `<html>`. Every rule that consumes these lives in
 * globals.css — this only sets the switches.
 */
export function applyPreferences(prefs: Preferences): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("dark", resolvedTheme(prefs) === "dark");
  el.dataset.density = prefs.density;
  el.dataset.textSize = prefs.textSize;
  el.dataset.contrast = prefs.highContrast ? "high" : "normal";
  el.dataset.motion = prefs.reduceMotion ? "reduced" : "full";
}

// ── Module store (mirrors src/lib/i18n) ──

let current: Preferences | null = null;
const listeners = new Set<() => void>();

function ensureLoaded(): Preferences {
  if (current === null) current = readPreferences();
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Preferences {
  return ensureLoaded();
}

const SERVER_SNAPSHOT: Preferences = { ...DEFAULT_PREFERENCES };

/** Merge a patch, persist it, repaint, and notify subscribers. */
export function setPreferences(patch: Partial<Preferences>): void {
  const next = normalizePreferences({ ...ensureLoaded(), ...patch });
  current = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      // Keep the legacy key truthful so anything still reading it agrees.
      window.localStorage.setItem(LEGACY_THEME_KEY, resolvedTheme(next));
    } catch {
      /* private mode — the in-memory value still applies this session */
    }
  }
  applyPreferences(next);
  listeners.forEach((l) => l());
}

/**
 * Preferences + a setter. `role` only decides the default when nobody has
 * chosen a mode yet — an explicit choice always wins.
 */
export function usePreferences(role?: string | null): {
  prefs: Preferences;
  mode: UiMode;
  setPrefs: (patch: Partial<Preferences>) => void;
  toggleMode: () => void;
} {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const mode = resolveMode(prefs.mode, role);
  return {
    prefs,
    mode,
    setPrefs: setPreferences,
    toggleMode: () => setPreferences({ mode: mode === "simple" ? "advanced" : "simple" }),
  };
}

let systemThemeBound = false;

/**
 * Repaint on OS theme changes while `theme: "system"` is selected.
 *
 * Bound at most once per page. Two mount sites call this — the app root and the
 * authenticated shell — and `matchMedia` hands back a fresh MediaQueryList per
 * call, so without the guard each mount stacked another `change` listener that
 * nothing ever removed. The listener is meant to live for the whole page (the
 * preference can change at any time), which is exactly why it is a guarded
 * page-lifetime singleton rather than something an effect cleans up. Same
 * pattern as the popstate and telemetry binders.
 */
export function bindSystemTheme(): void {
  if (systemThemeBound || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  systemThemeBound = true;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const prefs = ensureLoaded();
    if (prefs.theme === "system") applyPreferences(prefs);
  };
  mq.addEventListener("change", onChange);
}
