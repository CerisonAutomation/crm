import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { DEFAULT_PLATFORM_SETTINGS, SETTINGS_SECTIONS } from "@/lib/settings/registry";
import { WEBHOOK_TOPICS } from "@/lib/integrations/webhooks";
import { CASE_EVENT_TOPICS } from "@/lib/services/event-hub";
import { INTEGRATION_LABELS } from "@/lib/integrations";
import { CONTROLLER, PROCESSING_ACTIVITIES, PURGE_TIER } from "@/lib/compliance/data-map";

/**
 * Platform manifest — a machine-readable description of the platform so
 * external automation can discover and drive it.
 *
 * GET /api/manifest   staff only (CLIENT → 403). Returns the settings registry
 *                     (sections, roles, field types and canon defaults), the
 *                     outbound webhook topic catalogue, the internal case-event
 *                     topics, the integration keys and the data-governance model
 *                     (controller, processing activities, purge tier).
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);

    const canon = DEFAULT_PLATFORM_SETTINGS as unknown as Record<string, Record<string, unknown>>;
    const settings = SETTINGS_SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      readRoles: s.readRoles,
      writeRoles: s.writeRoles,
      fields: s.fields.map((f) => ({
        key: f.key,
        type: f.type,
        label: f.label,
        default: canon[s.key]?.[f.key],
      })),
    }));

    // Data-governance model, so external automation can discover how the
    // platform classifies and retains data without scraping the RoPA route.
    const governance = {
      controller: CONTROLLER,
      activities: PROCESSING_ACTIVITIES.map((a) => ({
        id: a.id,
        name: a.name,
        lawfulBasis: a.lawfulBasis,
        dataClass: a.dataClass,
        retentionDays: a.retention.days,
        legalHold: a.retention.legalHold,
      })),
      purgeTier: PURGE_TIER,
    };

    return jsonOk({
      version: "1.0",
      settings,
      webhooks: { topics: WEBHOOK_TOPICS },
      events: { topics: CASE_EVENT_TOPICS },
      integrations: { keys: Object.keys(INTEGRATION_LABELS) },
      governance,
    });
  })(req);
}
