"use client";
/**
 * Offline banner (G12) — one slim, branded connectivity indicator for EVERY
 * view. Mounted once in `src/app/page.tsx` inside the Suspense boundary, so
 * the public landing and the authenticated shell share the same instance.
 *
 * Connectivity sources (all funnelled through `apply`):
 *  · the browser `online` / `offline` events,
 *  · an initial `navigator.onLine` correction inside the effect (state starts
 *    "online" so the SSR render never touches `window`),
 *  · the native shell's `cl:network` re-broadcast of the Capacitor
 *    NetworkStatus (`{ connected, connectionType }` — see native-shell.tsx).
 *
 * While offline it shows the branded bar; when connectivity returns it flips
 * to a brief "back online" confirmation that self-dismisses after ~4s. It is
 * fixed (zero layout shift), sits at z-[45] — above the z-40 sticky headers,
 * below every modal overlay (z-50+) — and its only motion is a subtle fade-in
 * that the global `prefers-reduced-motion` guard collapses to 0.01ms.
 */
import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** How long the "back online" confirmation stays up. */
const BACK_ONLINE_MS = 4000;

/** Tolerant read of the `cl:network` detail (Capacitor NetworkStatus). */
function connectedFrom(detail: unknown): boolean | null {
  if (typeof detail === "boolean") return detail;
  if (typeof detail === "object" && detail !== null && "connected" in detail) {
    return Boolean((detail as { connected: unknown }).connected);
  }
  return null;
}

export function OfflineBanner() {
  const { t } = useI18n();
  // SSR-safe: starts "online" and is corrected from window in the effect below.
  const [online, setOnline] = useState(true);
  const [showBackOnline, setShowBackOnline] = useState(false);
  const wasOffline = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const apply = (isOnline: boolean) => {
      if (isOnline) {
        if (!wasOffline.current) {
          setOnline(true); // initial correction — no-op when already online
          return;
        }
        // offline → online transition: confirm, then self-dismiss.
        wasOffline.current = false;
        setOnline(true);
        setShowBackOnline(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setShowBackOnline(false), BACK_ONLINE_MS);
      } else {
        wasOffline.current = true;
        clearTimeout(timer.current);
        setOnline(false);
        setShowBackOnline(false);
      }
    };

    apply(typeof navigator === "undefined" ? true : navigator.onLine);

    const onOnline = () => apply(true);
    const onOffline = () => apply(false);
    const onNative = (e: Event) => {
      const connected = connectedFrom((e as CustomEvent<unknown>).detail);
      if (connected !== null) apply(connected);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("cl:network", onNative);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("cl:network", onNative);
    };
  }, []);

  if (online && !showBackOnline) return null;
  const offline = !online;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-[45] animate-in fade-in-0 duration-200",
        "border-b border-gold/50 bg-cobble px-4 pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))]",
        "text-gold-ink shadow-sm",
      )}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 text-sm">
        {offline ? (
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="font-medium">{offline ? t("app.offline") : t("app.backOnline")}</span>
        {offline && (
          <span className="hidden min-w-0 truncate text-gold-ink/80 sm:inline">{t("app.offlineHint")}</span>
        )}
      </div>
    </div>
  );
}
