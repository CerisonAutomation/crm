import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { WEBHOOK_TOPICS } from "@/lib/integrations/webhooks";
import {
  deleteEndpoint,
  discover,
  listEndpoints,
  plan,
  provision,
  rotateEndpoint,
  setEndpointActive,
} from "@/lib/services/autopilot";

export const dynamic = "force-dynamic";

/**
 * Autopilot — automation auto-detection & auto-generation.
 *
 * GET  /api/autopilot            → discovered resources + dry-run plan + endpoints
 * POST /api/autopilot            → { action }:
 *   scan      — re-detect and return the provisioning plan (no writes)
 *   provision — generate/repair an inbound hook per published workflow
 *   rotate    — { id } — new token + secret (secret returned once)
 *   toggle    — { id, active }
 *   delete    — { id }
 *
 * ADMIN only (automation.manage) — this manages live, externally-callable URLs.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    const [resources, provisioningPlan, endpoints] = await Promise.all([
      discover(ctx.orgId),
      plan(ctx.orgId),
      listEndpoints(ctx.orgId),
    ]);
    return jsonOk({ resources, plan: provisioningPlan, endpoints, topics: WEBHOOK_TOPICS });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    const body = await readJson<{ action?: string; id?: string; active?: boolean }>(r);
    const actorLabel = `${ctx.name} [${ctx.role}]`;

    switch (body.action) {
      case "scan": {
        const [resources, provisioningPlan] = await Promise.all([discover(ctx.orgId), plan(ctx.orgId)]);
        return jsonOk({
          resources,
          plan: provisioningPlan,
          summary: {
            exposable: provisioningPlan.length,
            toCreate: provisioningPlan.filter((p) => p.action === "create").length,
            toRepair: provisioningPlan.filter((p) => p.action === "repair").length,
          },
        });
      }

      case "provision": {
        const result = await provision(ctx.orgId, actorLabel);
        await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel, action: "autopilot.scan", target: "hook-endpoints", after: { created: result.created, repaired: result.repaired }, correlationId });
        return jsonOk({ ...result, endpoints: await listEndpoints(ctx.orgId) });
      }

      case "rotate": {
        if (!body.id) throw new DomainError("id required", 400);
        const result = await rotateEndpoint(ctx.orgId, body.id);
        await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel, action: "autopilot.hook.rotated", target: result.endpoint.url, correlationId });
        return jsonOk(result);
      }

      case "toggle": {
        if (!body.id) throw new DomainError("id required", 400);
        const endpoint = await setEndpointActive(ctx.orgId, body.id, body.active === true);
        await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel, action: "autopilot.hook.toggled", target: endpoint.url, after: { active: endpoint.active }, correlationId });
        return jsonOk({ endpoint });
      }

      case "delete": {
        if (!body.id) throw new DomainError("id required", 400);
        await deleteEndpoint(ctx.orgId, body.id);
        await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel, action: "autopilot.hook.deleted", target: body.id, correlationId });
        return jsonOk({ ok: true });
      }

      default:
        throw new DomainError("Unknown autopilot action", 400);
    }
  })(req);
}
