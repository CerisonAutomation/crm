import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, audit, actorLabel } from "@/lib/api-helpers";
import {
  getWebhookInboxEntry,
  markWebhookProcessing,
  markWebhookProcessed,
} from "@/lib/services/webhook-inbox";
import { notFound } from "@/lib/api-errors";

// GET /api/webhook-inbox/[id] — ADMIN-only inbound webhook detail.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const entry = await getWebhookInboxEntry(id);
    if (!entry || entry.orgId !== ctx.orgId) throw notFound("Webhook entry not found");
    return jsonOk({ entry });
  })(req);
}

// POST /api/webhook-inbox/[id] — operator replay: mark processing then processed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const existing = await getWebhookInboxEntry(id);
    if (!existing || existing.orgId !== ctx.orgId) throw notFound("Webhook entry not found");
    await markWebhookProcessing(id);
    const entry = await markWebhookProcessed(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "webhook.replayed",
      target: id,
      after: { status: entry.status, provider: entry.provider },
      correlationId,
    });
    return jsonOk({ entry });
  })(req);
}
