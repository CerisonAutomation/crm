import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { bindingHealth } from "@/lib/services/page-bindings";
import { resolvePublicOrgId } from "../../_lib/public-org";
import { liveContent } from "../../_lib/page-content";
import { isFeatureEnabled } from "@/lib/settings/features";
export const dynamic = "force-dynamic";

type LaneBlock = { key: string; type: string; config: Record<string, unknown> };

// GET /api/pages/public/[slug] — PUBLIC article detail.
// Returns the FULL block list plus form-binding health so a visitor can actually
// read the article and submit its questionnaire. Only PUBLISHED pages of the
// PUBLIC organisation are ever exposed. A form block whose formKey is not bound
// to a LIVE workflow (exists · published · enabled · same org) is marked
// `bound: false` so the client renders a graceful fallback, never a dead button —
// a binding saved before the target workflow was unpublished or deleted counts as
// unbound here.
//
// The page's TENANT is resolved independently of the slug so a page belonging to
// any other Organisation is invisible (slug alone must not name a tenant).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  return handler(async () => {
    const { slug } = await ctx.params;
    const orgId = await resolvePublicOrgId();
    if (!orgId) throw new DomainError("Page not found", 404);
    // lane_pages_public kill-switch: hidden journal reads as 404.
    if (!(await isFeatureEnabled("lane_pages_public").catch(() => true)))
      throw new DomainError("Page not found", 404);

    const page = await db.lanePage.findFirst({
      where: { slug, status: "PUBLISHED", orgId },
      select: {
        id: true,
        title: true,
        slug: true,
        blocks: true,
        bindings: true,
        orgId: true,
        version: true,
        currentRevisionId: true,
        publishedRevisionId: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
    if (!page) throw new DomainError("Page not found", 404);

    // Prefer the LIVE revision; a page with no revision renders from `blocks`.
    const content = await liveContent(page);
    const blocks = parse<LaneBlock[]>(content.blocks, []);
    const { liveKeys } = await bindingHealth({
      orgId: page.orgId,
      bindings: content.bindings,
    });

    const forms = blocks
      .filter((b) => b.type === "form")
      .map((b) => String(b.config?.formKey ?? ""))
      .filter(Boolean)
      .map((formKey) => ({ formKey, bound: liveKeys.has(formKey) }));

    return jsonOk({
      page: {
        id: page.id,
        title: page.title,
        slug: page.slug,
        version: content.version,
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
        blocks,
        forms,
      },
    });
  })(req);
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
