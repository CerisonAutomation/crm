"use client";
/**
 * Legal footer navigation — one row of links to the legal centre, shared by the
 * landing page and the public (guest) shell so neither can drift.
 *
 * Links are plain `<a href="/legal/...">` (not view-store navigation): the legal
 * pages are static server routes with stable, crawlable URLs, so they must be
 * reachable by a cold load, a search engine and an email link. The "Cookie
 * settings" control reopens the consent panel via the banner's window event.
 */
import { COOKIE_BANNER, LEGAL_NAV } from "@/lib/legal/content";
import { openCookieSettings } from "@/components/brand/cookie-consent";

export function LegalFooterNav({ tone = "light" }: { tone?: "light" | "dark" }) {
  // `inline-flex items-center` + a min-height gives every link a real hit area
  // without touching the type size or tracking — the extra height is invisible
  // padding, so the row still reads as one line. 44px on touch widths (the
  // mobile target the audit measured), 24px from `sm` up (WCAG 2.2 SC 2.5.8),
  // so the desktop footer stays as tight as it was.
  const linkClass =
    tone === "dark"
      ? "inline-flex min-h-11 items-center sm:min-h-6 text-[10px] uppercase tracking-[0.18em] text-[#F5F1EA]/70 hover:text-gold-ink"
      : "inline-flex min-h-11 items-center sm:min-h-6 text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold-ink";

  return (
    <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {LEGAL_NAV.map((item) => (
        <a key={item.slug} href={`/legal/${item.slug}`} className={linkClass}>
          {item.label}
        </a>
      ))}
      <button type="button" onClick={openCookieSettings} className={linkClass}>
        {COOKIE_BANNER.settingsLabel}
      </button>
    </nav>
  );
}
