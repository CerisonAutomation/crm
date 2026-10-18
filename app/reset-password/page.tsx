"use client";
/**
 * Standalone entry point for emailed password-reset links
 * (`/reset-password?token=…`). The app is otherwise a single-route SPA, so this
 * thin route mounts the same client component and hands navigation back to `/`
 * once the flow completes — without it the server-issued links would 404.
 */
import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { ResetPassword } from "@/features/auth/password-reset";

export default function ResetPasswordPage() {
  const view = useApp((s) => s.view);
  const armed = useRef(false);

  // Align the store view with this entry surface.
  useEffect(() => {
    useApp.getState().setView("reset-password");
  }, []);

  // Once the component moves the view on (saved / back / missing token), hand
  // off to the SPA root — this route cannot render the rest of the app.
  useEffect(() => {
    if (view === "reset-password") {
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

  return <ResetPassword />;
}
