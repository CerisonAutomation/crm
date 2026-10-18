"use client";
/**
 * Platform settings — client module store.
 *
 * Fetch /api/settings ONCE on first use, merge the result over the canon
 * defaults and expose it through usePlatformSettings(). The store is a module
 * singleton (useSyncExternalStore) so every consumer shares one request and
 * re-renders when the settings arrive — no provider needed.
 *
 * Resilience: any fetch error silently keeps the canon defaults (the server
 * already omits sections the role may not read), so a consumer always renders
 * and never blocks. This mirrors the useSyncExternalStore pattern in
 * src/lib/i18n/index.ts.
 */
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api-client";
import { mergePlatformSettings, type PlatformSettings } from "./registry";

type PlatformSettingsState = { settings: PlatformSettings; loading: boolean };

const INITIAL: PlatformSettingsState = { settings: mergePlatformSettings(undefined), loading: true };

let state: PlatformSettingsState = INITIAL;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

/** Fetch the readable settings once; never throws, never blocks render. */
function ensureFetch() {
  if (started || globalThis.window === undefined) return;
  started = true;
  api
    .platformSettings()
    .then(({ settings }) => {
      state = { settings: mergePlatformSettings(settings), loading: false };
    })
    .catch(() => {
      state = { settings: mergePlatformSettings(undefined), loading: false };
    })
    .finally(emit);
}

/** The settings hook — `const { settings, loading } = usePlatformSettings()`. */
export function usePlatformSettings(): PlatformSettingsState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  ensureFetch();
  return snapshot;
}
