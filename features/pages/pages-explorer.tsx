"use client";
/**
 * Public Pages Explorer — "The Citizen Lane Journal".
 *
 * PagesExplore — editorial directory of published Lane Pages (no auth needed;
 *   data comes exclusively from GET /api/pages/public via api.publicPages()).
 * PagesReader — graceful reader for a single published page (hero editorial),
 *   rendered through the SHARED `PublicArticle` (which itself renders via the
 *   shared block-renderer) so the journal, the SSR permalink and the builder
 *   canvas can never drift.
 *
 * Public data carries only published pages and their hero — drafts, bindings
 * and submissions never reach this surface.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { Eyebrow, EmptyState } from "@/components/brand/ui";
import { PublicShell } from "@/components/brand/public-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { PublicArticle, humanizeSlug } from "./public-article";

type PublicPage = Awaited<ReturnType<typeof api.publicPages>>["pages"][number];
type PublicPageDetail = Awaited<ReturnType<typeof api.publicPage>>["page"];

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}


// ─────────────────────────────────────────────────────────────────────────────
// PagesExplore — public directory
// ─────────────────────────────────────────────────────────────────────────────

export function PagesExplore() {
  const setPublicPage = useApp((s) => s.setPublicPage);
  const [pages, setPages] = useState<PublicPage[] | null>(null); // null = loading
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.publicPages();
        if (!cancelled) setPages(res.pages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** Retry — event-handler side: reset to loading, then re-trigger the effect. */
  const retry = () => {
    setPages(null);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <PublicShell active="journal">
      <section className="pt-14 pb-16">
        <Eyebrow>Published pages</Eyebrow>
        <h1 className="mt-4 font-editorial text-4xl md:text-5xl leading-[1.08] text-cobble-ink text-balance max-w-2xl">
          The Citizen Lane Journal
        </h1>
        <div className="h-[2px] w-24 bg-gold mt-6" aria-hidden="true" />
        <p className="mt-6 max-w-xl text-iron-ink leading-relaxed">
          Notes from the private office on residence and citizenship by investment —
          published openly for prospective clients and friends of the firm.
        </p>

        <div className="mt-12" aria-busy={pages === null && !error}>
          {error ? (
            <div className="flex flex-col items-start gap-4 rounded-none border border-dashed border-gold/60 bg-card/60 p-8">
              <p className="text-sm text-iron-ink">
                The journal could not be loaded{error ? ` — ${error}` : ""}.
              </p>
              <Button
                variant="outline"
                onClick={retry}
                className="rounded-none border-cobble text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : pages === null ? (
            <ExploreSkeleton />
          ) : pages.length === 0 ? (
            <EmptyState
              title="No published pages yet"
              hint="The private office has not published any journal entries — please return soon."
              className="rounded-none"
            />
          ) : (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {pages.map((p) => (
                <PageCard key={p.id} page={p} onOpen={() => setPublicPage(p.slug)} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </PublicShell>
  );
}

/** Editorial card — whole surface clickable, keyboard operable. */
function PageCard({ page, onOpen }: { page: PublicPage; onOpen: () => void }) {
  const headline = page.hero?.headline?.trim() || page.title;
  const subline = page.hero?.subline?.trim() || "";
  const when = formatDate(page.publishedAt ?? page.updatedAt);

  return (
    <li>
      <Card
        role="button"
        tabIndex={0}
        aria-label={`Read: ${headline}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="group h-full cursor-pointer rounded-none border-border/70 bg-card/80 transition-all duration-200 hover:border-gold/70 hover:shadow-[0_18px_40px_-18px_rgba(18,40,58,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <CardContent className="flex h-full flex-col p-6 md:p-7">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="rounded-none text-[10px] tracking-[0.14em] text-iron-ink/80">
              {humanizeSlug(page.slug)}
            </Badge>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              v{page.version}
            </span>
          </div>
          <h2 className="mt-5 font-editorial text-xl leading-snug text-cobble-ink text-balance">
            {headline}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-iron-ink line-clamp-2 min-h-[2.5rem]">
            {subline || "An entry from the Citizen Lane private office."}
          </p>
          <div className="mt-auto pt-6">
            <div className="h-[1px] w-10 bg-limestone group-hover:bg-gold transition-colors" aria-hidden="true" />
            <div className="mt-4 flex items-center justify-between gap-2">
              {when && (
                <time className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {when}
                </time>
              )}
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-ink">
                Read
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function ExploreSkeleton() {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i}>
          <div className="rounded-none border border-border/70 bg-card/60 p-6 md:p-7">
            <Skeleton className="h-4 w-24 rounded-none" />
            <Skeleton className="mt-6 h-6 w-4/5 rounded-none" />
            <Skeleton className="mt-3 h-4 w-full rounded-none" />
            <Skeleton className="mt-2 h-4 w-2/3 rounded-none" />
            <Skeleton className="mt-8 h-[1px] w-10 rounded-none" />
            <Skeleton className="mt-4 h-3 w-20 rounded-none" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PagesReader — single published page
// ─────────────────────────────────────────────────────────────────────────────

export function PagesReader() {
  const slug = useApp((s) => s.activePublicSlug);
  const setPublicPage = useApp((s) => s.setPublicPage);
  // undefined = loading · null = not found / no slug selected
  const [page, setPage] = useState<PublicPageDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!slug) return; // no page selected — rendered from state below
    let cancelled = false;
    (async () => {
      try {
        const res = await api.publicPage(slug);
        if (!cancelled) setPage(res.page);
      } catch {
        if (!cancelled) setPage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  /** Retry — event-handler side: reset to loading, then re-trigger the effect. */
  const retry = () => {
    setError(null);
    setPage(undefined);
    setReloadKey((k) => k + 1);
  };

  return (
    <PublicShell active="journal" width="prose">
      {!slug ? (
        <section className="pt-14 pb-16">
          <Eyebrow>The Citizen Lane Journal</Eyebrow>
          <h1 className="mt-4 font-editorial text-3xl md:text-4xl text-cobble-ink">No page selected</h1>
          <div className="h-[2px] w-24 bg-gold mt-6" aria-hidden="true" />
          <p className="mt-6 max-w-xl text-iron-ink leading-relaxed">
            Return to the journal index to choose an entry.
          </p>
          <Button
            variant="outline"
            onClick={() => setPublicPage(null)}
            className="mt-8 rounded-none border-cobble text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All pages
          </Button>
        </section>
      ) : error ? (
        <section className="pt-14 pb-16">
          <div className="flex flex-col items-start gap-4 rounded-none border border-dashed border-gold/60 bg-card/60 p-8">
            <p className="text-sm text-iron-ink">This entry could not be loaded{error ? ` — ${error}` : ""}.</p>
            <Button
              variant="outline"
              onClick={retry}
              className="rounded-none border-cobble text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </section>
      ) : page === undefined ? (
        <ReaderSkeleton />
      ) : page === null ? (
        <section className="pt-14 pb-16">
          <Eyebrow>The Citizen Lane Journal</Eyebrow>
          <h1 className="mt-4 font-editorial text-3xl md:text-4xl text-cobble-ink">Page not found</h1>
          <div className="h-[2px] w-24 bg-gold mt-6" aria-hidden="true" />
          <p className="mt-6 max-w-xl text-iron-ink leading-relaxed">
            It may have been unpublished — return to the journal index to see what is currently open to readers.
          </p>
          <Button
            variant="outline"
            onClick={() => setPublicPage(null)}
            className="mt-8 rounded-none border-cobble text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All pages
          </Button>
        </section>
      ) : (
        <PublicArticle page={page} />
      )}

    </PublicShell>
  );
}

function ReaderSkeleton() {
  return (
    <section className="flex-1 mx-auto w-full max-w-3xl px-5 md:px-8 pt-12 pb-20" aria-busy="true">
      <Skeleton className="h-3 w-40 rounded-none" />
      <Skeleton className="mt-8 h-12 w-11/12 rounded-none" />
      <Skeleton className="mt-4 h-12 w-2/3 rounded-none" />
      <Skeleton className="mt-10 h-4 w-full rounded-none" />
      <Skeleton className="mt-2 h-4 w-5/6 rounded-none" />
      <Skeleton className="mt-2 h-4 w-1/2 rounded-none" />
    </section>
  );
}
