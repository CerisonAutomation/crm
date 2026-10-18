import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { emitAutomationEvent } from "@/lib/adapters/automation";
import { generatePageDraft } from "@/lib/services/ai-composer";
import { DomainError } from "@/lib/domain/states";

/**
 * POST /api/selfbuild/page — compose a Lane Page from a natural-language brief.
 * The brief is composed in-process by the AI composer. Result: a DRAFT Lane
 * Page, editable in the builder.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = await readJson<{ brief?: string; title?: string }>(r);
    const brief = (body.brief ?? "").trim();
    if (!brief) throw new DomainError("Brief required", 400);
    if (brief.length > 2000) throw new DomainError("Brief too long (2000 chars max)", 400);

    const correlationId = `sbp-${Date.now().toString(36)}`;
    const via = "direct";
    const draft = await generatePageDraft(brief);
    const artifact: { title: string; blocks: unknown } = { title: draft.title, blocks: draft.blocks };
    const provider = draft.provider;

    const title = (body.title?.trim() || artifact.title || "AI Composed Page").slice(0, 120);
    const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "ai-page";
    let slug = baseSlug;
    for (let i = 2; await db.lanePage.findUnique({ where: { slug } }); i++) slug = `${baseSlug}-${i}`;

    const page = await db.lanePage.create({
      data: {
        orgId: ctx.orgId,
        title,
        slug,
        ownerId: ctx.userId,
        blocks: JSON.stringify(artifact.blocks),
        bindings: JSON.stringify([]),
      },
    });

    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "selfbuild.page.created", target: slug,
      after: { via, provider, blocks: JSON.stringify(artifact.blocks).length }, correlationId,
    });
    // Fire-and-forget completion event — durable queue so a slow fan-out never
    // slows the builder, and a restart cannot lose the notification.
    void emitAutomationEvent("selfbuild.completed", { mode: "page", via, provider, slug, pageId: page.id }, { correlationId, actor: `${ctx.name} [${ctx.role}]`, orgId: ctx.orgId, defer: true });

    return jsonOk({ page: { id: page.id, title: page.title, slug: page.slug }, via, provider }, 201);
  })(req);
}
