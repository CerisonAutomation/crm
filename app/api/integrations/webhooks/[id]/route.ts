import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";
import { WEBHOOK_TOPICS, generateEndpointSecret } from "@/lib/integrations/webhooks";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/integrations/webhooks/[id] — update url/description/events, toggle
// active, or rotate the signing secret (rotateSecret: true → new secret is
// returned ONCE in plaintext).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    const existing = await db.webhookEndpoint.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Webhook endpoint not found", 404);

    const body = await readJson<{
      url?: string;
      description?: string;
      events?: string[];
      active?: boolean;
      rotateSecret?: boolean;
    }>(r);

    const data: { url?: string; description?: string; events?: string; active?: boolean; secret?: string } = {};

    if (typeof body.url === "string" && body.url.trim() && body.url.trim() !== existing.url) {
      let parsed: URL;
      try {
        parsed = new URL(body.url.trim());
      } catch {
        throw new DomainError("Endpoint URL must be a valid absolute URL", 400);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new DomainError("Endpoint URL must use http or https", 400);
      }
      data.url = body.url.trim();
    }

    if (typeof body.description === "string") data.description = body.description.trim();

    if (Array.isArray(body.events)) {
      const events = body.events.filter((e): e is string => typeof e === "string");
      if (events.length === 0) throw new DomainError("Subscribe to at least one event topic", 400);
      const valid = new Set<string>([...WEBHOOK_TOPICS, "*"]);
      const unknown = events.filter((e) => !valid.has(e));
      if (unknown.length > 0) throw new DomainError(`Unknown event topic(s): ${unknown.join(", ")}`, 400);
      data.events = JSON.stringify(events);
    }

    if (typeof body.active === "boolean") data.active = body.active;

    let rotatedSecret: string | null = null;
    if (body.rotateSecret === true) {
      rotatedSecret = generateEndpointSecret();
      data.secret = rotatedSecret;
    }

    const row = await db.webhookEndpoint.update({ where: { id }, data });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: body.rotateSecret ? "webhook.secret.rotated" : "webhook.endpoint.updated",
      target: row.url,
      after: { id: row.id, events: data.events ?? undefined, active: data.active ?? undefined },
      correlationId,
    });

    return jsonOk({
      endpoint: {
        id: row.id,
        url: row.url,
        description: row.description,
        events: JSON.parse(row.events) as string[],
        active: row.active,
      },
      ...(rotatedSecret ? { secret: rotatedSecret } : undefined), // shown once, never again
    });
  })(req);
}

// DELETE /api/integrations/webhooks/[id] — remove the endpoint and its delivery log.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    const existing = await db.webhookEndpoint.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new DomainError("Webhook endpoint not found", 404);
    await db.webhookEndpoint.delete({ where: { id } }); // deliveries cascade
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "webhook.endpoint.deleted",
      target: existing.url,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
