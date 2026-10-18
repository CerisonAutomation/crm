"use client";
/**
 * Standalone entry point for emailed verification links (`/verify-email?token=…`).
 * The app is otherwise a single-route SPA, so this thin route mounts the same
 * client component and hands navigation back to `/` once the flow completes —
 * without it the server-issued links would 404.
 */
import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { VerifyEmail } from "@/features/auth/verify-email";

export default function VerifyEmailPage() {
  const view = useApp((s) => s.view);
  const armed = useRef(false);

  // Align the store view with this entry surface.
  useEffect(() => {
    useApp.getState().setView("verify-email");
  }, []);

  // Once the component moves the view on (verified / back / skip), hand off to
  // the SPA root — this route cannot render the rest of the app.
  useEffect(() => {
    if (view === "verify-email") {
      armed.current = true;
      return;
    }
    if (armed.current) {
      // Deliberate full reload: router.push would keep this route's shell,
      // which cannot render the rest of the app.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/?view=${encodeURIComponent(view)}`);
    }
  }, [view]);

  return <VerifyEmail />;
}
