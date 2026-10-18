"use client";
/**
 * Account policy — client module store.
 *
 * The sign-up and password-reset screens must show the same minimum the server
 * enforces, and they run before a session exists. `/api/policy` is public for
 * that reason; this store fetches it once and shares it, mirroring the
 * useSyncExternalStore pattern in `src/lib/i18n` and `src/lib/settings/client`.
 *
 * A fetch failure keeps the canon default rather than blocking the form: the
 * server re-checks every password anyway, so an unreachable policy endpoint can
 * only make the client hint conservative, never wrong in the permissive
 * direction beyond the default.
 */
import { useSyncExternalStore } from "react";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

type PolicyState = { passwordMinLength: number; loading: boolean };

const INITIAL: PolicyState = { passwordMinLength: PASSWORD_MIN_LENGTH, loading: true };

let state: PolicyState = INITIAL;
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

function ensureFetch() {
  if (started || typeof window === "undefined") return;
  started = true;
  fetch("/api/policy", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d: { passwordMinLength?: number }) => {
      state = {
        passwordMinLength: typeof d.passwordMinLength === "number" ? d.passwordMinLength : PASSWORD_MIN_LENGTH,
        loading: false,
      };
    })
    .catch(() => {
      state = { passwordMinLength: PASSWORD_MIN_LENGTH, loading: false };
    })
    .finally(emit);
}

/** The minimum password length the platform enforces right now. */
export function usePasswordMinLength(): number {
  ensureFetch();
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).passwordMinLength;
}
