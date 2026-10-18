"use client";
/**
 * Root error boundary (App Router `global-error.tsx`). Catches errors thrown in
 * the ROOT LAYOUT itself, where `error.tsx` cannot. It must render its own
 * <html>/<body> and must NOT assume the root layout's providers exist — so it is
 * deliberately dependency-free (no i18n, no brand components, no UI library).
 */
import { useEffect } from "react";
import { reportClientError } from "@/lib/errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest, scope: "global" });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#F5F1EA", color: "#12283A" }}>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p style={{ maxWidth: 420, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            The application hit an unexpected error. You can retry — the problem has been
            recorded for our team.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: "10px 20px", border: "1px solid #12283A", background: "#12283A", color: "#F5F1EA", cursor: "pointer" }}
            >
              Try again
            </button>
            {/* A full reload is the safest recovery when the root layout itself failed. */}
            {/* eslint-disable @next/next/no-location-assign-relative-destination -- router state is untrustworthy here by definition */}
            <button
              type="button"
              onClick={() => window.location.assign("/")}
              style={{ padding: "10px 20px", border: "1px solid #12283A", background: "transparent", color: "#12283A", cursor: "pointer" }}
            >
              Go home
            </button>
            {/* eslint-enable @next/next/no-location-assign-relative-destination */}
          </div>
        </main>
      </body>
    </html>
  );
}
