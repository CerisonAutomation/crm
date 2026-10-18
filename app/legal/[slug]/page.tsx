import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  LEGAL_CONTACT,
  LEGAL_PAGES,
  LEGAL_UPDATED,
  legalPageBySlug,
  type LegalSection,
} from "@/lib/legal/content";

/**
 * `/legal/[slug]` — a single published legal document.
 *
 * Rendered entirely server-side from `@/lib/legal/content`, so the page has a
 * stable, crawlable URL and does not depend on the client view store or a
 * database seed. Unknown slugs 404.
 */
export function generateStaticParams() {
  return LEGAL_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = legalPageBySlug(slug);
  if (!page) return { title: "Not found — Citizen Lane" };
  return {
    title: `${page.title} — Citizen Lane`,
    description: page.summary,
  };
}

function Section({ section }: { section: LegalSection }) {
  const noteRole = section.note?.tone === "warn" ? "alert" : "note";
  return (
    <section className="mt-8">
      {section.heading && (
        <h2 className="font-editorial text-xl leading-snug text-cobble-ink">{section.heading}</h2>
      )}
      {section.paragraphs && section.paragraphs.length > 0 && (
        <div className="mt-3 space-y-3">
          {section.paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-iron-ink">
              {p}
            </p>
          ))}
        </div>
      )}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 space-y-2">
          {section.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-iron-ink">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {section.note && (
        <div
          role={noteRole}
          className={
            section.note.tone === "warn"
              ? "mt-4 border-l-2 border-gold bg-gold/10 p-4 text-[13px] font-medium leading-relaxed text-cobble-ink"
              : "mt-4 border-l-2 border-cobble/30 bg-card/60 p-4 text-[13px] leading-relaxed text-iron-ink"
          }
        >
          {section.note.text}
        </div>
      )}
    </section>
  );
}

export default async function LegalPageView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = legalPageBySlug(slug);
  if (!page) notFound();

  return (
    <article>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">{page.eyebrow}</p>
      <h1 className="mt-3 font-editorial text-4xl leading-[1.1] text-cobble-ink text-balance">{page.title}</h1>
      <div className="mt-6 h-[2px] w-24 bg-gold" aria-hidden="true" />
      <p className="mt-6 max-w-xl leading-relaxed text-iron-ink">{page.summary}</p>
      <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        Version in force: {LEGAL_UPDATED}
      </p>

      <div className="mt-10">
        {page.sections.map((section, i) => (
          <Section key={section.heading ?? i} section={section} />
        ))}
      </div>

      <div className="mt-12 border-t border-border/70 pt-6">
        <p className="text-sm text-iron-ink">
          Questions about this document? Write to{" "}
          <a href={`mailto:${LEGAL_CONTACT.general}`} className="text-cobble-ink underline underline-offset-4 hover:text-gold-ink">
            {LEGAL_CONTACT.general}
          </a>
          .
        </p>
        <Link
          href="/legal"
          className="mt-4 inline-block text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-ink hover:underline"
        >
          ← All legal & compliance
        </Link>
      </div>
    </article>
  );
}
