import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT, LEGAL_PAGES, LEGAL_UPDATED, SHORT_REGULATORY_NOTE } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Legal & compliance — Citizen Lane",
  description:
    "Imprint, privacy policy, terms of service, AML/KYC, cookie policy, risk warning, complaints and other legal information.",
};

/** The legal centre index — every published legal document, in reading order. */
export default function LegalIndexPage() {
  return (
    <article>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">Legal & compliance</p>
      <h1 className="mt-3 font-editorial text-4xl leading-[1.1] text-cobble-ink text-balance">
        The small print, in plain sight
      </h1>
      <div className="mt-6 h-[2px] w-24 bg-gold" aria-hidden="true" />
      <p className="mt-6 max-w-xl leading-relaxed text-iron-ink">
        Citizenship and residence by investment is a regulated field. These documents set out who we are,
        how we handle your data and funds, the risks, and how to raise a concern.
      </p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {LEGAL_PAGES.map((page) => (
          <li key={page.slug}>
            <Link
              href={`/legal/${page.slug}`}
              className="block h-full border border-border/70 bg-card/60 p-5 transition-colors hover:border-gold/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-gold-ink">{page.eyebrow}</p>
              <p className="mt-2 font-editorial text-lg text-cobble-ink">{page.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-iron-ink">{page.summary}</p>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-12 border-t border-border/70 pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-iron-ink">Regulatory note</p>
        <p className="mt-3 text-sm leading-relaxed text-iron-ink">{SHORT_REGULATORY_NOTE}</p>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Questions? {LEGAL_CONTACT.general} · Version in force: {LEGAL_UPDATED}
        </p>
      </section>
    </article>
  );
}
