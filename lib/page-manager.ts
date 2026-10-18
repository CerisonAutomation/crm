/**
 * page-manager — runtime state for page/tab enable/disable, custom labels,
 * and custom ordering. Persisted to localStorage so changes survive reloads.
 *
 * Zenith Vibe Engineering: modular, enable/disable, customizable.
 */
import { create } from "zustand";
import type { View } from "@/lib/store";
import { PAGE_REGISTRY } from "@/lib/page-registry";

const STORAGE_KEY = "cl.pageManager.v1";

/** Default: all pages enabled, no custom labels, registry order. */
type PageManagerState = {
  /** view → enabled (absent = default true) */
  enabled: Partial<Record<View, boolean>>;
  /** view → custom label override (absent = use registry labelKey) */
  customLabels: Partial<Record<View, string>>;
  /** view → custom order index (absent = use registry order) */
  customOrder: Partial<Record<View, number>>;
  /** Whether the manager has been hydrated from localStorage */
  hydrated: boolean;

  // ── Actions ──────────────────────────────────────────────────────────
  togglePage: (view: View) => void;
  setPageEnabled: (view: View, enabled: boolean) => void;
  setCustomLabel: (view: View, label: string) => void;
  setCustomOrder: (view: View, order: number) => void;
  resetToDefaults: () => void;
  hydrate: () => void;

  // ── Selectors ───────────────────────────────────────────────────────
  isPageEnabled: (view: View) => boolean;
  getEffectiveLabel: (view: View, defaultLabel: string) => string;
  getEffectiveOrder: (view: View, defaultOrder: number) => number;
};

/** Read persisted state from localStorage. */
function loadPersisted(): {
  enabled: Partial<Record<View, boolean>>;
  customLabels: Partial<Record<View, string>>;
  customOrder: Partial<Record<View, number>>;
} {
  if (typeof window === "undefined") {
    return { enabled: {}, customLabels: {}, customOrder: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: {}, customLabels: {}, customOrder: {} };
    const parsed = JSON.parse(raw) as {
      enabled?: Partial<Record<View, boolean>>;
      customLabels?: Partial<Record<View, string>>;
      customOrder?: Partial<Record<View, number>>;
    };
    return {
      enabled: parsed.enabled ?? {},
      customLabels: parsed.customLabels ?? {},
      customOrder: parsed.customOrder ?? {},
    };
  } catch {
    return { enabled: {}, customLabels: {}, customOrder: {} };
  }
}

/** Persist state to localStorage. */
function persist(state: {
  enabled: Partial<Record<View, boolean>>;
  customLabels: Partial<Record<View, string>>;
  customOrder: Partial<Record<View, number>>;
}): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode — ignore */
  }
}

/** Default order index for a view (its position in the registry). */
const DEFAULT_ORDER: Record<string, number> = {};
PAGE_REGISTRY.forEach((p, i) => {
  if (!(p.view in DEFAULT_ORDER)) DEFAULT_ORDER[p.view] = i;
});

export const usePageManager = create<PageManagerState>((set, get) => ({
  enabled: {},
  customLabels: {},
  customOrder: {},
  hydrated: false,

  togglePage: (view) => {
    const current = get().enabled[view];
    const next = current === undefined ? false : !current;
    const enabled = { ...get().enabled, [view]: next };
    set({ enabled });
    persist({ ...get(), enabled });
  },

  setPageEnabled: (view, enabled) => {
    const next = { ...get().enabled, [view]: enabled };
    set({ enabled: next });
    persist({ ...get(), enabled: next });
  },

  setCustomLabel: (view, label) => {
    const next = { ...get().customLabels, [view]: label };
    set({ customLabels: next });
    persist({ ...get(), customLabels: next });
  },

  setCustomOrder: (view, order) => {
    const next = { ...get().customOrder, [view]: order };
    set({ customOrder: next });
    persist({ ...get(), customOrder: next });
  },

  resetToDefaults: () => {
    set({ enabled: {}, customLabels: {}, customOrder: {} });
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  },

  hydrate: () => {
    if (get().hydrated) return;
    const persisted = loadPersisted();
    set({ ...persisted, hydrated: true });
  },

  isPageEnabled: (view) => {
    const val = get().enabled[view];
    return val === undefined ? true : val;
  },

  getEffectiveLabel: (view, defaultLabel) => {
    const custom = get().customLabels[view];
    return custom || defaultLabel;
  },

  getEffectiveOrder: (view, defaultOrder) => {
    const custom = get().customOrder[view];
    return custom ?? defaultOrder;
  },
}));

/** Get the default order for a view. */
export function defaultOrderFor(view: View): number {
  return DEFAULT_ORDER[view] ?? 999;
}

/** Check if a view is enabled (non-reactive, for use in render). */
export function isPageEnabledSync(
  enabled: Partial<Record<View, boolean>>,
  view: View,
): boolean {
  return enabled[view] === undefined ? true : enabled[view];
}
