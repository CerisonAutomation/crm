import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { LaneBlock } from "@/lib/api-client";
import { bindingHealth } from "@/lib/services/page-bindings";
import { resolvePublicOrgId } from "@/app/api/pages/_lib/public-org";
import { draftContent, liveContent } from "@/app/api/pages/_lib/page-content";
import { verifyPagePreviewToken } from "@/app/api/pages/_lib/preview-token";
import { PublicArticle, type PublicArticleData } from "@/features/pages/public-article";

/**
 * `/p/[slug]` — the SERVER-RENDERED public article permalink.
 *
 * Before this route existed the editor advertised `/p/{slug}` but the only real
 * URL was the client-rendered `?view=article&slug=…`, so a published article had
 * no per-page metadata and was invisible to crawlers. This route renders the
 * SAME blocks through the shared `PublicArticle` (which uses the shared
 * `block-renderer`), pins the tenant, and emits per-page metadata.
 *
 * Always dynamic: a freshly published revision must be the revision served.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Loaded = { page: PublicArticleData; preview: boolean; status: string; orgId: string };

/**
 * Resolve a page for rendering, honouring a signed draft-preview token.
 *
 * The tenant is resolved INDEPENDENTLY of the slug (see `_lib/public-org`), so a
 * page belonging to another Organisation is never reachable — the slug alone
 * must not name a tenant. Cached per request so `generateMetadata` and the page
 * body share one lookup.
 */
const loadPage = cache(async (slug: string, previewToken: string | null): Promise<Loaded | null> => {
  const orgId = await resolvePublicOrgId();
  if (!orgId) return null; // no public tenant configured → expose nothing

  const preview = verifyPagePreviewToken(slug, previewToken);
  const row = await db.lanePage.findFirst({
    where: preview ? { slug, orgId } : { slug, orgId, status: "PUBLISHED" },
    select: {
      id: true, title: true, slug: true, status: true, orgId: true,
      blocks: true, bindings: true, version: true,
      currentRevisionId: true, publishedRevisionId: true,
      publishedAt: true, updatedAt: true,
    },
  });
  if (!row) return null;

  // Preview shows the DRAFT (current revision); the public sees the LIVE revision.
  const content = preview ? await draftContent(row) : await liveContent(row);
  const blocks = parse<LaneBlock[]>(content.blocks, []);
  const { liveKeys } = await bindingHealth({ orgId: row.orgId, bindings: content.bindings });

  const forms = blocks
    .filter((b) => b.type === "form")
    .map((b) => String(b.config?.formKey ?? ""))
    .filter(Boolean)
    .map((formKey) => ({ formKey, bound: liveKeys.has(formKey) }));

  return {
    orgId: row.orgId,
    preview,
    status: row.status,
    page: {
      id: row.id,
      title: row.title,
      slug: row.slug,
      version: content.version,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
      blocks,
      forms,
    },
  };
});

/** Hero headline/subline from the rendered blocks — the article's own summary. */
function heroOf(blocks: LaneBlock[]): { headline: string; subline: string } {
  const hero = blocks.find((b) => b.type === "hero");
  if (!hero) return { headline: "", subline: "" };
  const cfg = hero.config ?? {};
  return {
    headline: typeof cfg.headline === "string" ? cfg.headline : "",
    subline: typeof cfg.subline === "string" ? cfg.subline : "",
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const token = typeof sp.preview === "string" ? sp.preview : null;
  const loaded = await loadPage(slug, token);
  if (!loaded) return { title: "Not found — Citizen Lane" };

  const hero = heroOf(loaded.page.blocks);
  const title = hero.headline.trim() || loaded.page.title;
  const description = hero.subline.trim() || `${loaded.page.title} — the Citizen Lane Journal.`;
  return {
    title: `${title} — Citizen Lane`,
    description,
    // A draft preview is never indexed; a published article advertises its
    // canonical, crawlable permalink.
    robots: loaded.preview ? { index: false, follow: false } : undefined,
    alternates: loaded.preview ? undefined : { canonical: `/p/${loaded.page.slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      ...(loaded.page.publishedAt ? { publishedTime: loaded.page.publishedAt } : {}),
    },
  };
}

export default async function PublicPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const token = typeof sp.preview === "string" ? sp.preview : null;
  const loaded = await loadPage(slug, token);
  if (!loaded) notFound();
  return <PublicArticle page={loaded.page} preview={loaded.preview} />;
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}
