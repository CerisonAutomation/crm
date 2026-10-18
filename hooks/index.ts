"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Debounce a rapidly-changing value — ideal for search inputs and filters so
 * the expensive work (query, render, network) runs once the user pauses.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** A debounced callback that also exposes `cancel()` and `flush()`. */
export type DebouncedCallback<A extends unknown[]> = ((...args: A) => void) & {
  /** Drop a pending invocation without running it. */
  cancel: () => void;
  /** Run a pending invocation immediately. */
  flush: () => void;
};

/**
 * Debounce a callback. The latest arguments win, the timer is cleared on
 * unmount, and the callback identity is stable across renders. The returned
 * function also exposes `cancel()` and `flush()`.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs = 250,
): DebouncedCallback<A> {
  const fnRef = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const argsRef = useRef<A | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Drop any pending invocation when the owner unmounts.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      argsRef.current = null;
    },
    [],
  );

  // The function is constructed and configured inside the memo and never
  // mutated afterwards, so its identity changes only when `delayMs` does.
  return useMemo(() => {
    const debounced = ((...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      argsRef.current = args;
      timer.current = setTimeout(() => {
        timer.current = null;
        argsRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    }) as DebouncedCallback<A>;

    debounced.cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      argsRef.current = null;
    };

    debounced.flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const args = argsRef.current;
      argsRef.current = null;
      if (args) fnRef.current(...args);
    };

    return debounced;
  }, [delayMs]);
}

const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribeToMobileQuery(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

/** Cheap and `Object.is`-stable: a boolean, so no snapshot cache is needed. */
function getIsMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/** There is no viewport during SSR; the desktop layout is the safe default. */
function getIsMobileServer(): boolean {
  return false;
}

/**
 * Reactive `matchMedia` check. Reads the platform through
 * `useSyncExternalStore` rather than a mount-then-setState effect, so the
 * first paint already has the right answer and resizes never lag a render.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeToMobileQuery, getIsMobile, getIsMobileServer);
}
