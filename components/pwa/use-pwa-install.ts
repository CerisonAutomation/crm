"use client";

import { useSyncExternalStore } from "react";

/**
 * Single owner of Chromium's `beforeinstallprompt` and of the "not now" snooze.
 *
 * The event fires once per page load and the deferred event is the only way to
 * trigger the real install prompt, so both install surfaces — the standing
 * banner in `pwa-client.tsx` and the "Mobile app" row in Settings — must read
 * the same one. Capturing it twice would leave whichever listener ran second
 * holding a stale reference.
 *
 * Module state + `useSyncExternalStore` keeps that shared without adding a
 * provider, matching the app's provider-free theme handling. Keeping the snooze
 * here too means the banner derives its visibility instead of syncing it in an
 * effect, and both surfaces agree on what "dismissed" means.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

type Snapshot = { canInstall: boolean; installed: boolean; dismissed: boolean };

const SERVER_SNAPSHOT: Snapshot = { canInstall: false, installed: false, dismissed: false };

const DISMISS_KEY = "cl.pwa.dismissed";
const DISMISS_DAYS = 14;

const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let armed = false;
// useSyncExternalStore requires a snapshot that is referentially stable while
// nothing has changed, so the object is replaced only when a value differs.
let snapshot: Snapshot = SERVER_SNAPSHOT;

function notify() {
  for (const listener of listeners) listener();
}

function readsStandalone(): boolean {
  if (globalThis.window === undefined) return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone,
  );
}

/** Hidden for 14 days after "Not now", then allowed one more appearance. */
function readsDismissed(): boolean {
  if (globalThis.window === undefined) return false;
  try {
    const ts = Number(window.localStorage.getItem(DISMISS_KEY) ?? "0");
    return ts > 0 && Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function getInstallSnapshot(): Snapshot {
  const next: Snapshot = {
    canInstall: deferred !== null,
    installed: readsStandalone(),
    dismissed: readsDismissed(),
  };
  if (
    next.canInstall !== snapshot.canInstall ||
    next.installed !== snapshot.installed ||
    next.dismissed !== snapshot.dismissed
  ) {
    snapshot = next;
  }
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

export function subscribeInstall(callback: () => void): () => void {
  if (!armed && globalThis.window !== undefined) {
    armed = true;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferred = event as BeforeInstallPromptEvent;
      notify();
    });
    window.addEventListener("appinstalled", () => {
      deferred = null;
      notify();
    });
    window.matchMedia?.("(display-mode: standalone)").addEventListener("change", notify);
  }
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Trigger the browser's install prompt. "unavailable" means no prompt exists. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return "unavailable";
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === "accepted") {
    deferred = null;
    notify();
  }
  return choice.outcome;
}

/** Snooze every install surface for DISMISS_DAYS. */
export function dismissInstall(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode — the banner still hides for this session via notify() */
  }
  notify();
}

export function isIosDevice(): boolean {
  if (globalThis.window === undefined) return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * `canInstall` is false on iOS Safari and on browsers that never fire the event,
 * where the only real path is the manual "Add to Home Screen" steps.
 */
export function usePwaInstall() {
  const { canInstall, installed, dismissed } = useSyncExternalStore(
    subscribeInstall,
    getInstallSnapshot,
    getServerSnapshot,
  );
  return {
    canInstall,
    installed,
    dismissed,
    ios: isIosDevice(),
    install: promptInstall,
    dismiss: dismissInstall,
  };
}
