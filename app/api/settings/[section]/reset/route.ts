import { NextRequest } from "next/server";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { findSettingsSection, sectionWriteCapability } from "@/lib/settings/registry";
import { loadPlatformSettings, resetPlatformSettingsSection } from "@/lib/settings/store";

/**
 * Platform Settings — reset one section to canon.
 *
 * POST /api/settings/[section]/reset   the section's own writeCapability
 *                                      (default `settings.write`, ADMIN-only;
 *                                      desk-owned sections declare
 *                                      `settings.desk.write`) AND the role must
 *                                      be in the section's writeRoles. Removes
 *                                      the stored override and audits the reset
 *                                      with before/after.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section: sectionKey } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const section = findSettingsSection(sectionKey);
    if (!section) throw new DomainError(`Unknown settings section "${sectionKey}"`, 400);
    requireCapability(ctx, sectionWriteCapability(section));
    if (!section.writeRoles.includes(ctx.role)) throw new DomainError("Forbidden", 403);

    const before = await loadPlatformSettings();
    const after = await resetPlatformSettingsSection(ctx.orgId, section.key);

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: `settings.${section.key}.reset`,
      target: `BrandSetting/${ctx.orgId}:platform.${section.key}`,
      before: before[section.key],
      after: after[section.key],
      correlationId,
    });
    return jsonOk({ settings: after, reset: true });
  })(req);
}
