import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";
import {
  WEBHOOK_TOPICS,
  generateEndpointSecret,
  listEndpoints,
  processDueRetries,
} from "@/lib/integrations/webhooks";

// GET /api/integrations/webhooks — endpoint list (+ due retry catch-up sweep)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage"); // ADMIN only
    await processDueRetries(); // catch-up sweep: process retries due while the server was idle
    const endpoints = await listEndpoints(ctx.orgId);
    return jsonOk({ endpoints });
  })(req);
}

// POST /api/integrations/webhooks — create an endpoint; the 32-byte signing
// secret is returned ONCE in this response and never again in plaintext.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    const body = await readJson<{ url?: string; description?: string; events?: string[]; active?: boolean }>(r);

    const url = (body.url ?? "").trim();
    if (!url) throw new DomainError("Endpoint URL is required", 400);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DomainError("Endpoint URL must be a valid absolute URL", 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new DomainError("Endpoint URL must use http or https", 400);
    }

    const events = (body.events ?? []).filter((e): e is string => typeof e === "string");
    if (events.length === 0) throw new DomainError("Subscribe to at least one event topic", 400);
    const valid = new Set<string>([...WEBHOOK_TOPICS, "*"]);
    const unknown = events.filter((e) => !valid.has(e));
    if (unknown.length > 0) throw new DomainError(`Unknown event topic(s): ${unknown.join(", ")}`, 400);

    const secret = generateEndpointSecret();
    const row = await db.webhookEndpoint.create({
      data: {
        url,
        description: (body.description ?? "").trim(),
        secret,
        events: JSON.stringify(events),
        active: body.active ?? true,
        orgId: ctx.orgId,
      },
    });

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "webhook.endpoint.created",
      target: url,
      after: { id: row.id, events, active: row.active },
      correlationId,
    });

    // Secret is returned exactly once — masked everywhere else.
    return jsonOk({ endpoint: { id: row.id, url: row.url, description: row.description, events, active: row.active }, secret }, 201);
  })(req);
}
