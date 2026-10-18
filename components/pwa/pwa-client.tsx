"use client";

/**
 * PWA install experience — real installability, zero fake buttons.
 *
 * Behavior matrix (honest by design):
 *  - Chromium desktop/Android: `beforeinstallprompt` captured → branded card with
 *    a real one-tap install (event.prompt()).
 *  - iOS/iPadOS Safari: no install prompt API exists → card opens a step-by-step
 *    "Add to Home Screen" dialog (the only real path Apple allows).
 *  - Any other browser without support: renders nothing (no dead UI).
 *  - Already installed (display-mode: standalone): renders nothing.
 *  - Dismissed: snoozed for 14 days, then may reappear once.
 * Also registers /sw.js exactly once — production only (push + static cache);
 * in development the worker is actively unregistered so it can never serve a
 * stale Turbopack chunk.
 *
 * The deferred `beforeinstallprompt` event and the snooze are owned by
 * `use-pwa-install`, so the Settings "Mobile app" row offers the same real
 * install instead of a second capture racing this one, and visibility stays
 * derived from that shared state rather than synced in an effect.
 */

import { useEffect, useState } from "react";
import { Download, Plus, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { usePwaInstall } from "@/components/pwa/use-pwa-install";

export function PwaClient() {
  const { t } = useI18n();
  const { canInstall, installed, dismissed, ios, install, dismiss } =
    usePwaInstall();
  const [iosReady, setIosReady] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (globalThis.window === undefined || !("serviceWorker" in navigator))
      return;

    // Development must never be driven by a service worker. Turbopack rebuilds
    // chunks in place, so the worker's stale-while-revalidate hands back a chunk
    // from an earlier build whose internal module ids no longer exist — the
    // "module factory is not available" crash. Tear down any worker (and its
    // caches) a previous session left behind, then leave dev unregistered.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        // Preserve the Transformers.js weight bucket: dev teardown clears
        // stale shell caches, never the on-device model weights.
        void caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((k) => !k.includes("transformers"))
                .map((k) => caches.delete(k))
            )
          )
          .catch(() => {});
      }
      return;
    }

    // Service worker — register once per page load.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW unavailable (e.g. insecure context) — the app still works fully */
    });
  }, []);

  // Chromium fires the prompt event once a real install is possible; that alone
  // is the cue to offer the card. iOS Safari never fires it, so it gets the
  // manual path after a beat instead.
  useEffect(() => {
    if (installed || dismissed || canInstall || !ios) return;
    const timer = window.setTimeout(() => setIosReady(true), 4000);
    return () => window.clearTimeout(timer);
  }, [canInstall, dismissed, installed, ios]);

  const visible = !installed && !dismissed && (canInstall || iosReady);
  if (!visible) return null;

  const handleInstall = async () => {
    const outcome = await install();
    // No prompt available (iOS Safari, or an engine that never fires it): the
    // only real path is the manual one.
    if (outcome === "unavailable" && ios) setIosOpen(true);
  };

  const iosWithoutPrompt = !canInstall;

  return (
    <>
      <div
        role="dialog"
        aria-label={t("pwa.installTitle")}
        className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm border border-gold/40 bg-card/95 p-4 shadow-lg backdrop-blur sm:w-96"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded bg-cobble">
            <Smartphone className="h-5 w-5 text-gold-ink" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-editorial text-sm font-semibold text-cobble-ink">
              {t("pwa.installTitle")}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("pwa.installBody")}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void handleInstall()}
                className="min-h-11 bg-cobble text-[#F5F1EA] hover:bg-cobble/90"
              >
                {iosWithoutPrompt ? (
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" aria-hidden />
                )}
                {iosWithoutPrompt ? t("pwa.iosTitle") : t("pwa.installCta")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                className="min-h-11 text-muted-foreground"
              >
                {t("pwa.installLater")}
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("pwa.installLater")}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-cobble-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-editorial text-cobble-ink">
              {t("pwa.iosTitle")}
            </DialogTitle>
          </DialogHeader>
          <ol className="space-y-3 text-sm text-foreground">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobble text-xs font-semibold text-gold-ink">
                1
              </span>
              <span>{t("pwa.iosStep1")}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobble text-xs font-semibold text-gold-ink">
                2
              </span>
              <span>{t("pwa.iosStep2")}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobble text-xs font-semibold text-gold-ink">
                3
              </span>
              <span>{t("pwa.iosStep3")}</span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
