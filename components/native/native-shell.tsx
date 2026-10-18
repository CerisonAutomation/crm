"use client";
/**
 * Native shell bridge (Capacitor) — runs ONLY inside the iOS/Android build.
 *
 * On the web it is a no-op. On native it applies platform standards:
 *  · Status bar — brand colour, dark content, non-overlaying.
 *  · Splash screen — hidden once the app is interactive.
 *  · Android hardware back — navigates history, exits at the root.
 *  · Network — re-broadcast as a DOM event (`cl:network`) for an offline banner.
 *  · Haptics — a light tap on button/link presses (progressive enhancement).
 *
 * Everything is dynamic-imported and guarded so the web bundle is unaffected.
 */
import { useEffect } from "react";

export function NativeShell() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    // Removal callbacks, registered the moment each resource exists so a
    // teardown that races the async setup still releases everything.
    const removals: Array<() => void> = [];
    let onClick: ((e: Event) => void) | null = null;
    // Wired up once the native plugins load — the handler itself exists up
    // front so the effect cleanup can always name and remove it.
    let lightImpact: (() => void) | null = null;

    const detach = () => {
      if (onClick) {
        window.removeEventListener("click", onClick);
        onClick = null;
      }
      for (const remove of removals.splice(0)) remove();
    };

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        const [{ StatusBar, Style }, { SplashScreen }, { App }, { Keyboard, KeyboardResize }, { Network }, { Haptics, ImpactStyle }] =
          await Promise.all([
            import("@capacitor/status-bar"),
            import("@capacitor/splash-screen"),
            import("@capacitor/app"),
            import("@capacitor/keyboard"),
            import("@capacitor/network"),
            import("@capacitor/haptics"),
          ]);
        if (cancelled) return;

        await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
        await StatusBar.setBackgroundColor({ color: "#12283A" }).catch(() => undefined);
        await Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => undefined);
        await SplashScreen.hide().catch(() => undefined);
        if (cancelled) return;

        // Android hardware back button → app history.
        const backHandle = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else void App.exitApp();
        });
        removals.push(() => void backHandle.remove().catch(() => undefined));
        if (cancelled) {
          detach();
          return;
        }

        // Network status → DOM event (the UI can show an offline banner).
        const netHandle = await Network.addListener("networkStatusChange", (status) => {
          window.dispatchEvent(new CustomEvent("cl:network", { detail: status }));
        });
        removals.push(() => void netHandle.remove().catch(() => undefined));
        if (cancelled) {
          detach();
          return;
        }

        // Light haptic feedback on interactive taps.
        lightImpact = () => {
          void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
        };
        onClick = (e: Event) => {
          const el = (e.target as HTMLElement | null)?.closest("button, a");
          if (el) lightImpact?.();
        };
        window.addEventListener("click", onClick, { passive: true });
      } catch {
        /* web / unsupported — no native shell */
      }
    })();

    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  return null;
}
