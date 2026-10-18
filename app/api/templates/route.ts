import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

/**
 * Message templates — admin-managed notification copy with {{token}}
 * interpolation (canonical templating pattern; used by notify nodes and the
 * notification centre). ADMIN authors; RM/staff read (template.read).
 *
 * WHY THIS STAYS ADMIN-ONLY (reviewed judgement — not an oversight):
 * A message template is the COPY that automated workflow sends interpolate, so
 * authoring one is the copy-layer twin of authoring a workflow — and the
 * builders (workflow.write / page.write) are ADMIN-only by directive. Templates
 * are also strictly ORG-WIDE (`orgId_key_channel_locale`): editing one changes
 * the notification every colleague's cases emit, for every client. The new
 * desk capability (`settings.desk.write`) is deliberately DESK-SCOPED — it
 * opens only the two sections that govern the desk's own defaults. There is no
 * desk dimension on a template to scope a grant to, so allowing RM writes here
 * would be BROADER than the desk scope, not narrower. Kept on the ADMIN-only
 * `workflow.write` gate. RM/SENIOR_RM retain READ via `template.read`.
 *
 * GET    /api/templates           — list (org-scoped)
 * POST   /api/templates           — upsert by (orgId, key, channel, locale)
 * DELETE /api/templates?id=…      — remove
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);
    const templates = await db.messageTemplate.findMany({
      where: { orgId: ctx.orgId },
      orderBy: [{ key: "asc" }, { channel: "asc" }],
    });
    return jsonOk({ templates });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    // ADMIN-only builder gate (see the file header): templates author the copy
    // automated sends interpolate, org-wide — deliberately NOT covered by the
    // desk-scoped `settings.desk.write`.
    requireCapability(ctx, "workflow.write");

    const body = await readJson<{
      key?: string; name?: string; channel?: string; subject?: string; body?: string; locale?: string; active?: boolean;
    }>(r);
    if (!body.key || !body.name || !body.body) throw new DomainError("key, name and body are required", 400);
    const channel = body.channel ?? "IN_APP";
    if (!["IN_APP", "EMAIL", "WHATSAPP", "PUSH"].includes(channel)) throw new DomainError("Invalid channel", 400);
    const locale = body.locale ?? "en";

    const template = await db.messageTemplate.upsert({
      where: { orgId_key_channel_locale: { orgId: ctx.orgId, key: body.key, channel, locale } },
      update: {
        name: body.name,
        subject: body.subject ?? null,
        body: body.body,
        active: body.active ?? true,
      },
      create: {
        orgId: ctx.orgId,
        key: body.key,
        name: body.name,
        channel,
        subject: body.subject ?? null,
        body: body.body,
        locale,
        active: body.active ?? true,
      },
    });

    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "template.upserted", target: `${body.key}/${channel}/${locale}`, correlationId,
    });
    return jsonOk({ template }, 201);
  })(req);
}

export async function DELETE(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const id = r.nextUrl.searchParams.get("id");
    if (!id) throw new DomainError("id query param required", 400);
    const template = await db.messageTemplate.findUnique({ where: { id } });
    if (!template || template.orgId !== ctx.orgId) throw new DomainError("Template not found", 404);
    await db.messageTemplate.delete({ where: { id } });
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "template.deleted", target: template.key, correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
