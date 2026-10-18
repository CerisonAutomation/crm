import { db } from "@/lib/db";

/**
 * Resolve a Lane Page's CONTENT from its revision pointers.
 *
 * A page stores identity + pointers; the content lives in `PageRevision` rows.
 * A page with no pointer (every page that predates revisions, and any page whose
 * pointer dangles after a manual reorganisation) renders from its legacy
 * `blocks`/`bindings` columns — this is the backwards-compatibility guarantee.
 */

/** The columns of a LanePage row this resolver needs. */
export type ContentSource = {
  blocks: string;
  bindings: string;
  version: number;
  currentRevisionId: string | null;
  publishedRevisionId: string | null;
};

/** Page content after resolving revision pointers. */
export type PageContent = {
  blocks: string;
  bindings: string;
  /** Revision version when a revision resolved; else the page's stored version. */
  version: number;
  /** The revision id the content came from, or null for the legacy columns. */
  revisionId: string | null;
};

const legacy = (page: ContentSource): PageContent => ({
  blocks: page.blocks,
  bindings: page.bindings,
  version: page.version,
  revisionId: null,
});

async function contentFor(page: ContentSource, revisionId: string | null): Promise<PageContent> {
  if (!revisionId) return legacy(page);
  const rev = await db.pageRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, blocks: true, bindings: true, version: true },
  });
  if (!rev) return legacy(page); // dangling pointer → fall back, never throw
  return { blocks: rev.blocks, bindings: rev.bindings, version: rev.version, revisionId: rev.id };
}

/** Content the editor shows — the newest draft save, else legacy columns. */
export function draftContent(page: ContentSource): Promise<PageContent> {
  return contentFor(page, page.currentRevisionId);
}

/** Content the public reads — the LIVE revision, else legacy columns. */
export function liveContent(page: ContentSource): Promise<PageContent> {
  return contentFor(page, page.publishedRevisionId);
}

/**
 * Batch variant for list endpoints: resolve the live content for many pages in
 * TWO queries (pages + their revisions) instead of N. Result is index-aligned
 * with the input rows. Only the columns a list needs are required.
 */
export type LiveBatchSource = { blocks: string; version: number; publishedRevisionId: string | null };
export type LiveBatchContent = { blocks: string; version: number; revisionId: string | null };

export async function resolveLiveContentBatch(pages: LiveBatchSource[]): Promise<LiveBatchContent[]> {
  const ids = [...new Set(pages.map((p) => p.publishedRevisionId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return pages.map((p) => ({ blocks: p.blocks, version: p.version, revisionId: null }));
  const revs = await db.pageRevision.findMany({
    where: { id: { in: ids } },
    select: { id: true, blocks: true, version: true },
  });
  const byId = new Map(revs.map((r) => [r.id, r]));
  return pages.map((p) => {
    const rev = p.publishedRevisionId ? byId.get(p.publishedRevisionId) : undefined;
    return rev
      ? { blocks: rev.blocks, version: rev.version, revisionId: rev.id }
      : { blocks: p.blocks, version: p.version, revisionId: null };
  });
}
