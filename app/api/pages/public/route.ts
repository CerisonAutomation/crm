import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { resolvePublicOrgId } from "../_lib/public-org";
import { resolveLiveContentBatch } from "../_lib/page-content";
import { isFeatureEnabled } from "@/lib/settings/features";

// Always dynamic — the journal index must reflect fresh publications.
export const dynamic = "force-dynamic";

/**
 * GET /api/pages/public — published Lane Pages for the public explorer.
 * No auth: only PUBLISHED pages of the PUBLIC organisation and their marketing
 * blocks are exposed (never drafts, bindings, or submissions).
 *
 * TENANT SCOPE: the query is pinned to the resolved public Organisation id, so a
 * multi-tenant deployment never mixes one tenant's published pages into another's
 * journal. When no public tenant can be resolved (env unset AND more than one
 * Organisation exists — see `_lib/public-org`) the list is EMPTY: fail closed,
 * never "no filter".
 */
export async function GET(req: NextRequest) {
  return handler(async () => {
    const orgId = await resolvePublicOrgId();
    if (!orgId) return jsonOk({ pages: [] });
    // lane_pages_public kill-switch: the journal hides entirely when off.
    if (!(await isFeatureEnabled("lane_pages_public").catch(() => true)))
      return jsonOk({ pages: [] });

    const rows = await db.lanePage.findMany({
      where: { status: "PUBLISHED", orgId },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        slug: true,
        updatedAt: true,
        publishedAt: true,
        version: true,
        blocks: true,
        publishedRevisionId: true,
      },
    });

    // The hero (and version) come from the LIVE revision when one is published,
    // so the index matches the article a reader lands on.
    const live = await resolveLiveContentBatch(rows);

    return jsonOk({
      pages: rows.map((p, i) => {
        let hero: { headline?: string; subline?: string } = {};
        try {
          const blocks = JSON.parse(live[i].blocks) as Array<{
            type: string;
            config: Record<string, unknown>;
          }>;
          const h = blocks.find((b) => b.type === "hero");
          if (h)
            hero = {
              headline: String(h.config.headline ?? ""),
              subline: String(h.config.subline ?? ""),
            };
        } catch {
          /* keep empty */
        }
        return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          version: live[i].version,
          publishedAt: p.publishedAt,
          updatedAt: p.updatedAt,
          hero,
        };
      }),
    });
  })(req);
}
