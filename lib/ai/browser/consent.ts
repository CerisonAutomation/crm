"use client";
/**
 * AI consent gate — granular, on-device, versioned.
 *
 * Two independent switches: on-device inference (weights download + WebGPU
 * compute) and cloud fallback (OpenRouter via the server proxy). NOTHING in
 * src/lib/ai may run a model or call the cloud proxy until the matching
 * switch is granted. State lives in localStorage (per-device, per-browser);
 * server-side enforcement for cloud stays in /api/ai/cascade (feature flag +
 * auth), which this gate complements but never replaces.
 *
 * FOLLOW-UP (one line, out of rebuild scope): add "ai-local" and "ai-cloud"
 * to KEYS in src/app/api/privacy/consent/route.ts so the choice syncs to the
 * Consent table (Art. 7 proof) instead of living only on this device.
 */
import { useCallback, useSyncExternalStore } from "react";

export const AI_CONSENT_VERSION = "1";
const STORAGE_KEY = "cl_ai_consent_v1";

export type AiConsent = { local: boolean; cloud: boolean; version: string };

const DEFAULTS: AiConsent = { local: false, cloud: false, version: AI_CONSENT_VERSION };

export function getAiConsent(): AiConsent {
  if (globalThis.window === undefined) return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AiConsent>;
    if (parsed.version !== AI_CONSENT_VERSION) return { ...DEFAULTS };
    return { local: parsed.local === true, cloud: parsed.cloud === true, version: AI_CONSENT_VERSION };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAiConsent(next: Partial<Pick<AiConsent, "local" | "cloud">>): AiConsent {
  const current = getAiConsent();
  const merged: AiConsent = {
    local: next.local ?? current.local,
    cloud: next.cloud ?? current.cloud,
    version: AI_CONSENT_VERSION,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* private mode — gate simply re-asks next visit */
  }
  return merged;
}

/** True once the user has made ANY choice (granted or denied either switch). */
export function hasConsented(): boolean {
  if (globalThis.window === undefined) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

type ConsentSnapshot = { consent: AiConsent; decided: boolean };

/**
 * Snapshot cache. `useSyncExternalStore` compares snapshots with `Object.is`,
 * and `getAiConsent()` builds a fresh object on every call, so the value has
 * to be memoised and explicitly invalidated — otherwise React re-renders in a
 * loop. `update()` and cross-tab `storage` events both go through
 * `invalidate()`.
 */
let cache: ConsentSnapshot | null = null;
const listeners = new Set<() => void>();

/** Server/SSR view: there is no document, so nothing has been decided yet. */
const SERVER_SNAPSHOT: ConsentSnapshot = Object.freeze({
  consent: { ...DEFAULTS },
  decided: false,
});

function invalidate(): void {
  cache = null;
  for (const listener of listeners) listener();
}

function getSnapshot(): ConsentSnapshot {
  cache ??= { consent: getAiConsent(), decided: hasConsented() };
  return cache;
}

function getServerSnapshot(): ConsentSnapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // Cross-tab only: `storage` fires in every OTHER tab, never the writing one.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) invalidate();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Reactive consent state for gates and settings UI.
 *
 * localStorage is an external store, so it is read through
 * `useSyncExternalStore` instead of being hydrated in an effect: the value is
 * already correct on the first client render and stays in sync across tabs.
 */
export function useAiConsent(): { consent: AiConsent; decided: boolean; update: (n: Partial<Pick<AiConsent, "local" | "cloud">>) => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback((n: Partial<Pick<AiConsent, "local" | "cloud">>) => {
    // Same-tab write: no `storage` event fires here, so notify by hand.
    setAiConsent(n);
    invalidate();
  }, []);
  return { consent: snapshot.consent, decided: snapshot.decided, update };
}
