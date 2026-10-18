import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

// GET /api/pages — list lane pages
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "page.read");
    const pages = await db.lanePage.findMany({
      where: { orgId: ctx.orgId },
      include: { owner: { select: { name: true } }, _count: { select: { submissions: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return jsonOk({
      pages: pages.map((p) => ({
        id: p.id, title: p.title, slug: p.slug, status: p.status, version: p.version,
        owner: p.owner.name, submissions: p._count.submissions,
        publishedAt: p.publishedAt, updatedAt: p.updatedAt,
        blocks: JSON.parse(p.blocks), bindings: JSON.parse(p.bindings),
      })),
    });
  })(req);
}

// POST /api/pages — create draft page
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "page.write");
    const body = await readJson<{ title: string; slug?: string }>(r);
    if (!body.title?.trim()) throw new DomainError("Title required", 400);
    const slug = (body.slug || body.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const dup = await db.lanePage.findUnique({ where: { slug } });
    if (dup) throw new DomainError("Slug already in use", 409);
    const page = await db.lanePage.create({
      data: {
        orgId: ctx.orgId, title: body.title.trim(), slug, ownerId: ctx.userId,
        blocks: JSON.stringify([
          { key: "b1", type: "hero", config: { headline: body.title, subline: "Citizenship & Residence by Investment" } },
          { key: "b2", type: "text", config: { body: "" } },
          { key: "b3", type: "form", config: { formKey: slug, fields: [{ key: "name", label: "Full name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } },
          { key: "b4", type: "footer", config: { note: "Zurich | info@citizen-lane.com | +41 55 511 54 00" } },
        ]),
        bindings: JSON.stringify([]),
      },
    });
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: "page.created", target: page.slug });
    return jsonOk({ page: { id: page.id, slug: page.slug } }, 201);
  })(req);
}
