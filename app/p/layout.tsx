import type { Metadata } from "next";
import Link from "next/link";
import { PassportSeal, Wordmark } from "@/components/brand/devices";

/**
 * `/p/*` shell — the server-rendered chrome for a public Lane Page article.
 *
 * A published article needs a stable, crawlable URL. This layout gives `/p/[slug]`
 * a brand header/footer with PLAIN ANCHOR links (not the SPA view store, which is
 * not mounted on a standalone route) so the page survives a cold load, a crawler
 * and a link shared by email. `force-light` pins the light brand palette — the
 * public surfaces opt out of dark mode so light-only text tokens stay legible.
 */
export const metadata: Metadata = {
  title: "The Citizen Lane Journal",
  description: "Notes from the Citizen Lane private office on residence and citizenship by investment.",
};

export default function PublicPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="force-light min-h-screen flex flex-col bg-background text-foreground">
      {/* Keyboard-first skip link (WCAG 2.4.1). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:text-cobble-ink"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 md:px-8">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            aria-label="Citizen Lane — home"
          >
            <PassportSeal size={40} />
            <Wordmark size="sm" />
          </Link>
          <nav aria-label="Public sections" className="hidden items-center gap-5 md:flex">
            <Link href="/" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-iron-ink hover:text-gold-ink">
              Home
            </Link>
            <Link href="/journal" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-iron-ink hover:text-gold-ink">
              Journal
            </Link>
            <Link
              href="/?view=login"
              className="rounded-none bg-cobble px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#F5F1EA] hover:bg-cobble/90"
            >
              Client portal
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>

      <footer className="border-t border-border/60 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
          <nav aria-label="Citizen Lane" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold-ink">
              Home
            </Link>
            <Link href="/journal" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold-ink">
              Journal
            </Link>
            <Link href="/legal" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold-ink">
              Legal &amp; compliance
            </Link>
          </nav>
          <p className="mt-5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
            Citizen Lane — residence and citizenship by investment, Zurich. This article is published
            by the private office; it is information, not legal advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
