"use client";
/**
 * Cookie consent — the ePrivacy/GDPR consent gate.
 *
 * Non-essential cookies may only be set AFTER consent (ePrivacy Directive
 * Art. 5(3); GDPR Art. 6(1)(a), Art. 7), consent must be as easy to refuse as
 * to accept, and it must be withdrawable at any time (Art. 7(3)). This banner is
 * that gate: nothing non-essential is set until the visitor chooses, the two
 * primary actions are equally weighted, and a footer "Cookie settings" link
 * reopens the panel to change or withdraw a choice.
 *
 * The decision is stored first-party (localStorage + a SameSite cookie) so it
 * survives reloads on any deployment. Where the visitor is signed in, the choice
 * is also recorded server-side via POST /api/privacy/consent so it appears in
 * the account's consent history — best effort, never blocking the UI.
 *
 * Copy lives in `@/lib/legal/content` (the same module the Cookie Policy page
 * renders), so the banner and the policy cannot drift.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  COOKIE_BANNER,
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_VERSION,
} from "@/lib/legal/content";

/** Window event that reopens the preferences panel (fired by the footer link). */
export const COOKIE_SETTINGS_EVENT = "cl:open-cookie-settings";

/** Open the settings panel from anywhere (e.g. a footer button). */
export function openCookieSettings(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}

type Decision = { essential: true; analytics: boolean; marketing: boolean; version: number; ts: string };

function readDecision(): Decision | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Decision>;
    if (parsed.version !== COOKIE_CONSENT_VERSION) return null; // policy changed → re-ask
    return {
      essential: true,
      analytics: parsed.analytics === true,
      marketing: parsed.marketing === true,
      version: COOKIE_CONSENT_VERSION,
      ts: typeof parsed.ts === "string" ? parsed.ts : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function CookieConsent() {
  const session = useApp((s) => s.session);
  const [mounted, setMounted] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  // Read the stored decision after mount (SSR-safe: no window on the server).
  useEffect(() => {
    setMounted(true);
    const stored = readDecision();
    setDecision(stored);
    if (stored) {
      setAnalytics(stored.analytics);
      setMarketing(stored.marketing);
    }
    const reopen = () => {
      setShowDetails(true);
      setOpen(true);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  const persist = useCallback(
    (next: { analytics: boolean; marketing: boolean }) => {
      const record: Decision = {
        essential: true,
        analytics: next.analytics,
        marketing: next.marketing,
        version: COOKIE_CONSENT_VERSION,
        ts: new Date().toISOString(),
      };
      try {
        window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(record));
        // First-party cookie mirror — a defence so a cleared localStorage still
        // respects a prior refusal within the same browser where cookies survive.
        document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=${record.analytics ? "1" : "0"}${record.marketing ? "1" : "0"}; path=/; max-age=31536000; SameSite=Lax`;
      } catch {
        /* private mode — the choice still applies for this session */
      }
      setDecision(record);
      setAnalytics(next.analytics);
      setMarketing(next.marketing);
      setOpen(false);
      setShowDetails(false);

      // Signed-in visitors: record the decision server-side (best effort).
      if (session) {
        const post = (key: string, granted: boolean) =>
          fetch("/api/privacy/consent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key, version: String(COOKIE_CONSENT_VERSION), granted }),
          }).catch(() => undefined);
        void post("cookies", true);
        void post("marketing", next.marketing);
      }
    },
    [session],
  );

  if (!mounted) return null;

  // No decision yet → show the banner (not the settings panel).
  const needsDecision = decision === null;
  if (!needsDecision && !open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={COOKIE_BANNER.title}
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-border bg-card/98 backdrop-blur supports-[backdrop-filter]:bg-card/90 pb-[env(safe-area-inset-bottom)]"
    >
      {/* Compact bar on phones, full panel from md up. The full panel (title +
          long body + three buttons) was 349px tall on a 320×568 screen — 61%
          of the viewport, over the footer and the page's own content. On small
          screens the body copy moves behind "Manage preferences" (which already
          owns the detailed controls) so only a title row and the decision
          buttons remain. Every action and label is unchanged. */}
      <div className="mx-auto max-w-6xl px-4 py-3 md:px-8 md:py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-foreground">{COOKIE_BANNER.title}</p>
          {/* The policy stays one tap away while the body is collapsed. */}
          <Link
            href="/legal/cookie-policy"
            className="text-[11px] underline underline-offset-4 text-muted-foreground hover:text-gold-ink md:hidden"
          >
            {COOKIE_BANNER.policyLabel}
          </Link>
        </div>
        <p
          className={cn(
            "mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground",
            !showDetails && "hidden md:block",
          )}
        >
          {COOKIE_BANNER.body}{" "}
          <Link href="/legal/cookie-policy" className="underline underline-offset-4 hover:text-gold-ink">
            {COOKIE_BANNER.policyLabel}
          </Link>
          .
        </p>

        {showDetails && (
          <fieldset className="mt-4 space-y-2.5">
            <legend className="sr-only">{COOKIE_BANNER.manage}</legend>
            <label className="flex items-center gap-3 text-[13px] text-foreground">
              <input type="checkbox" checked disabled className="h-4 w-4 accent-[#B08C52]" />
              {COOKIE_BANNER.essential}
            </label>
            <label className="flex items-center gap-3 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="h-4 w-4 accent-[#B08C52]"
              />
              {COOKIE_BANNER.analytics}
            </label>
            <label className="flex items-center gap-3 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="h-4 w-4 accent-[#B08C52]"
              />
              {COOKIE_BANNER.marketing}
            </label>
          </fieldset>
        )}

        <div className="mt-3 flex flex-wrap gap-2 md:mt-4 md:gap-3">
          <button
            type="button"
            onClick={() => persist({ analytics: true, marketing: true })}
            className="rounded-none bg-cobble px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F5F1EA] hover:bg-cobble/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {COOKIE_BANNER.accept}
          </button>
          <button
            type="button"
            onClick={() => persist({ analytics: false, marketing: false })}
            className="rounded-none border border-cobble px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cobble-ink hover:bg-cobble/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {COOKIE_BANNER.reject}
          </button>
          {showDetails ? (
            <button
              type="button"
              onClick={() => persist({ analytics, marketing })}
              className="rounded-none border border-border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-iron-ink hover:border-gold hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {COOKIE_BANNER.save}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="rounded-none border border-border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-iron-ink hover:border-gold hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {COOKIE_BANNER.manage}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
