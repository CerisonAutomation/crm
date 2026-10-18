import type { Metadata } from "next";
import Link from "next/link";
import { PassportSeal, Wordmark } from "@/components/brand/devices";
import { LEGAL_CONTACT, LEGAL_FOOTER_NOTE, LEGAL_NAV, LEGAL_UPDATED } from "@/lib/legal/content";

/**
 * Legal centre shell — a small, server-rendered chrome for `/legal/*`.
 *
 * A commercial website's legal pages must be reachable at stable, indexable
 * URLs, independent of the app's client-side view store and of any database
 * seed. This layout gives them the brand header/footer with plain links so the
 * Imprint, Privacy Policy, Terms and the rest survive a cold load, a crawler and
 * a link shared by email. `force-light` pins the light brand palette (the public
 * surfaces opt out of dark mode so light-only text tokens stay legible).
 */
export const metadata: Metadata = {
  title: "Legal & compliance — Citizen Lane",
  description:
    "Imprint, privacy, terms, AML/KYC, risk warnings, complaints procedure and other legal information for Citizen Lane.",
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="force-light min-h-screen flex flex-col bg-background text-foreground">
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
          <nav aria-label="Legal pages" className="hidden items-center gap-5 md:flex">
            <Link href="/legal" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-iron-ink hover:text-gold-ink">
              Legal home
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

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 md:px-8">{children}</main>

      <footer className="border-t border-border/60 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_NAV.map((item) => (
              <Link
                key={item.slug}
                href={`/legal/${item.slug}`}
                className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">{LEGAL_FOOTER_NOTE}</p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {LEGAL_CONTACT.general} · Version in force: {LEGAL_UPDATED}
          </p>
        </div>
      </footer>
    </div>
  );
}
