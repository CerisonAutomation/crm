import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { findSettingsSection, sectionWriteCapability } from "@/lib/settings/registry";
import {
  loadPlatformSettings,
  savePlatformSettingsSection,
  validateSectionPatch,
} from "@/lib/settings/store";

/**
 * Platform Settings — one registry section.
 *
 * GET  /api/settings/[section]   authenticated; the role must be in the
 *                                section's readRoles (deny-by-default → 403).
 * PUT  /api/settings/[section]   the section's own writeCapability (default
 *                                `settings.write`, ADMIN-only — held by `*`
 *                                alone) AND the role must be in the section's
 *                                writeRoles. A desk-owned section declares
 *                                `writeCapability: "settings.desk.write"`,
 *                                which RM/SENIOR_RM hold (deny-by-default: any
 *                                section that does not declare it stays
 *                                ADMIN-only). Validates the patch from the
 *                                registry field types and audits the write.
 *                                Never trusts the client.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section: sectionKey } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const section = findSettingsSection(sectionKey);
    if (!section) throw new DomainError(`Unknown settings section "${sectionKey}"`, 400);
    if (!section.readRoles.includes(ctx.role)) throw new DomainError("Forbidden", 403);
    const merged = await loadPlatformSettings();
    return jsonOk({ settings: { [section.key]: merged[section.key] } });
  })(req);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section: sectionKey } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const section = findSettingsSection(sectionKey);
    if (!section) throw new DomainError(`Unknown settings section "${sectionKey}"`, 400);
    // Deny-by-default: the section's declared capability (ADMIN-only unless the
    // section opts into the desk capability) AND the section's own writeRoles.
    requireCapability(ctx, sectionWriteCapability(section));
    if (!section.writeRoles.includes(ctx.role)) throw new DomainError("Forbidden", 403);

    const body = await readJson<Record<string, unknown>>(r);
    const patch = validateSectionPatch(section.key, body);
    const before = await loadPlatformSettings();
    const after = await savePlatformSettingsSection(ctx.orgId, section.key, patch);

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: `settings.${section.key}.updated`,
      target: `BrandSetting/${ctx.orgId}:platform.${section.key}`,
      before: before[section.key],
      after: after[section.key],
      correlationId,
    });
    return jsonOk({ settings: after });
  })(req);
}
