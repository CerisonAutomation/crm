"use client";
/**
 * Test hook for the global error boundary.
 *
 * Renders nothing. When the URL carries `?crash-boundary=1` it throws once
 * per session, so e2e tests can verify the root-layout ErrorBoundary catches
 * a render error, shows the branded fallback, and recovers on "Try again".
 * Inert in normal use — no code path ever adds that parameter.
 */
import { useEffect, useState } from "react";

const TESTED_KEY = "cl.crashBoundaryTested";

export function ErrorBoundaryTestHook() {
  const [crash, setCrash] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("crash-boundary") !== "1") return;
    try {
      // Throw once per session so "Try again" has something to recover to.
      if (window.sessionStorage.getItem(TESTED_KEY)) return;
      window.sessionStorage.setItem(TESTED_KEY, "1");
    } catch {
      /* private mode — no flag available, so throw on every attempt */
    }
    setCrash(true);
  }, []);

  if (crash) throw new Error("Deliberate crash — error boundary test");
  return null;
}
