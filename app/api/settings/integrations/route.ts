import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { requireElevation } from "@/lib/services/auth-account";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";
import {
  getIntegration, setIntegration, maskConfig,
  INTEGRATION_LABELS, INTEGRATION_FIELDS, INTEGRATION_BLURBS, INTEGRATION_ORDER, integrationKind,
  type IntegrationKey, type IntegrationConfig,
} from "@/lib/integrations";

/** Every configurable connector — the canonical list lives with the integration layer. */
const VALID_KEYS: readonly IntegrationKey[] = INTEGRATION_ORDER;

/** GET /api/settings/integrations — admin view of every connector (secrets masked). */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    const integrations = await Promise.all(
      VALID_KEYS.map(async (key) => {
        const row = await db.integrationSetting.findUnique({ where: { key } });
        const { active, config } = await getIntegration(key);
        return {
          key,
          kind: row?.kind ?? integrationKind(key),
          label: INTEGRATION_LABELS[key],
          blurb: INTEGRATION_BLURBS[key],
          active,
          config: maskConfig(config),
          fields: INTEGRATION_FIELDS[key],
          updatedAt: row?.updatedAt?.toISOString() ?? null,
          updatedBy: row?.updatedBy ?? null,
        };
      })
    );
    return jsonOk({ integrations });
  })(req);
}

/** PUT /api/settings/integrations — upsert one connector config. Body: { key, config, active } */
export async function PUT(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");
    await requireElevation(ctx);
    const body = await readJson<{ key: string; config: IntegrationConfig; active: boolean }>(r);
    if (!VALID_KEYS.includes(body.key as IntegrationKey)) {
      throw new DomainError(`Unknown integration key: ${body.key}`, 400);
    }
    if (typeof body.config !== "object" || body.config === null) {
      throw new DomainError("config must be an object", 400);
    }
    // Secret fields left as the mask (•••) mean "unchanged" — merge with the
    // DECRYPTED stored value (setIntegration re-encrypts on write).
    const { config: stored } = await getIntegration(body.key as IntegrationKey);
    const merged: IntegrationConfig = { ...stored };
    for (const [k, v] of Object.entries(body.config ?? {})) {
      if (typeof v === "string" && v.includes("•••")) continue; // masked → keep stored
      merged[k] = v;
    }
    await setIntegration(body.key as IntegrationKey, merged, Boolean(body.active), ctx.email);
    await audit({
      orgId: ctx.orgId, action: "settings.integration.updated",
      target: body.key,
      actorId: ctx.userId,
      actorLabel: ctx.email,
      after: { active: Boolean(body.active) },
    });
    const { active, config } = await getIntegration(body.key as IntegrationKey);
    return jsonOk({ ok: true, key: body.key, active, config: maskConfig(config) });
  })(req);
}
