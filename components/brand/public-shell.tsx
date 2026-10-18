"use client";

/**
 * Public (guest) app shell.
 *
 * Before this existed, every public surface rolled its own chrome: the landing
 * page had a full marketing nav, while the Journal index and reader had only a
 * "← Citizen Lane" back button and their own footer. A guest moving between
 * them lost all navigation and had no route to sign-in — which is exactly why
 * the public site read as confusing.
 *
 * This is the ONE shell for guest-facing app surfaces (the Journal index and
 * reader). It gives them the same sticky header, primary nav, sign-in call to
 * action and footer as the rest of the product, so the public site behaves like
 * the app rather than a set of disconnected pages.
 *
 * The landing page keeps its own richer marketing header deliberately — a
 * landing page is marketing chrome, an app surface is navigation chrome.
 */
import { defaultViewFor, useApp } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useBrand } from "@/lib/brand/client";
import { PassportSeal, Wordmark } from "@/components/brand/devices";
import { LegalFooterNav } from "@/components/brand/legal-footer-nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A destination a guest can reach, and how it is announced. */
type PublicNavItem = {
  key: string;
  label: string;
  view: "landing" | "pages-explore";
};

const PUBLIC_NAV: readonly PublicNavItem[] = [
  { key: "home", label: "Home", view: "landing" },
  { key: "journal", label: "Journal", view: "pages-explore" },
];

export function PublicShell({
  /** Which nav entry to mark as current (`aria-current="page"`). */
  active,
  children,
  /** Optional width; the reader uses `prose` for a narrow editorial column. */
  width = "wide",
}: {
  active: string;
  children: React.ReactNode;
  width?: "wide" | "prose";
}) {
  const setView = useApp((s) => s.setView);
  const session = useApp((s) => s.session);
  const { t } = useI18n();
  // Brand copy is data, not translation: the contact line, wordmark and slogan
  // below render the live /api/brand values (canon when no row exists), so a
  // Settings → Brand edit reaches this shell without touching it.
  const brand = useBrand();

  return (
    <div className="force-light min-h-screen flex flex-col bg-background">
      {/* Keyboard-first skip link (WCAG 2.4.1) — the same device the app shell
          uses, so a guest on the Journal can jump the 5 header controls in one
          keystroke. Visible on focus only; it is the FIRST focusable element. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:text-cobble-ink"
      >
        {t("common.skipToContent")}
      </a>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto max-w-6xl px-5 md:px-8 h-16 flex items-center justify-between gap-3">
          {/* Brand — always returns the guest to the public home. */}
          <button
            type="button"
            onClick={() => setView("landing")}
            className="flex items-center gap-3 min-w-0 -ml-1 rounded-sm px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            aria-label={`${brand.wordmark.title} — home`}
          >
            <PassportSeal size={40} />
            <Wordmark size="sm" />
          </button>

          <nav aria-label="Public sections" className="hidden items-center gap-1 sm:flex">
            {PUBLIC_NAV.map((item) => {
              const current = item.key === active;
              return (
                <Button
                  key={item.key}
                  variant="ghost"
                  size="sm"
                  onClick={() => setView(item.view)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "-mr-0 text-[11px] uppercase tracking-[0.2em] font-semibold hover:bg-transparent hover:text-gold-ink",
                    current ? "text-cobble-ink" : "text-iron-ink",
                  )}
                >
                  {item.label}
                </Button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {/* A signed-in visitor who lands on a public page gets a way back
                into the app instead of an invitation to sign in again. */}
            {session ? (
              <Button
                size="sm"
                onClick={() => setView(session.role === "CLIENT" ? "client-dashboard" : session.role === "ADMIN" ? "admin-dashboard" : "rm-queue")}
                className="rounded-none bg-cobble text-[11px] uppercase tracking-[0.2em] font-semibold text-[#F5F1EA] hover:bg-cobble/90"
              >
                Open app
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView("login")}
                  className="hidden sm:inline-flex text-[11px] uppercase tracking-[0.2em] font-semibold text-iron-ink hover:bg-transparent hover:text-gold-ink"
                >
                  Sign in
                </Button>
                <Button
                  size="sm"
                  onClick={() => setView("signup")}
                  className="rounded-none bg-cobble text-[11px] uppercase tracking-[0.2em] font-semibold text-[#F5F1EA] hover:bg-cobble/90"
                >
                  Begin
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* tabIndex={-1} mirrors the app shell: it makes the skip link's target
          focusable, so activating it actually moves focus into main rather than
          only scrolling there. scroll-mt-16 clears the sticky header. */}
      <main id="main" tabIndex={-1} className="flex-1 scroll-mt-16">
        <div className={cn("mx-auto w-full px-5 md:px-8", width === "wide" ? "max-w-6xl" : "max-w-3xl")}>
          {children}
        </div>
      </main>

      <footer className="border-t border-border/60 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-6 flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <PassportSeal size={28} />
              <p className="text-[11px] text-muted-foreground">
                {brand.wordmark.title} — {brand.contact.city}&ensp;·&ensp;{brand.contact.email}&ensp;·&ensp;{brand.contact.phone}
              </p>
            </div>
            <nav aria-label="Public footer" className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => setView("pages-explore")}
                className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80 hover:text-gold-ink"
              >
                Journal
              </button>
              {/* Role-aware, like the header's "Open app": a signed-in reader
                  clicking this used to land on the sign-in form while already
                  authenticated, because the footer ignored the session. */}
              <button
                type="button"
                onClick={() => setView(session ? defaultViewFor(session) : "login")}
                className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80 hover:text-gold-ink"
              >
                Client portal
              </button>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
                {brand.slogan}
              </span>
            </nav>
          </div>
          <LegalFooterNav />
        </div>
      </footer>
    </div>
  );
}
