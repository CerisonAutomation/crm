import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { enforceRetention } from "@/lib/compliance/retention";

/**
 * Retention runner endpoint.
 *
 * POST /api/compliance/retention   settings.write capability (ADMIN only) AND a
 *                                  non-empty `reason`. Body `{ dryRun?: boolean }`.
 *                                  Runs the PURGE_TIER-only housekeeping pass and
 *                                  records a summary audit event (the per-model
 *                                  destruction rows are written by the runner
 *                                  itself). The client never chooses what is
 *                                  purged — only whether to preview it.
 */
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "settings.write");

    const body = await readJson<{ dryRun?: boolean; reason?: string }>(r);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw new DomainError("A reason is required", 400);

    const dryRun = body?.dryRun === true;
    const results = await enforceRetention({ dryRun });
    const totalDeleted = results.reduce((n, row) => n + row.deleted, 0);

    // Summary audit row (dry-runs are previews and are recorded as such).
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} <${ctx.email}> [${ctx.role}]`,
      action: "retention.run",
      target: "PURGE_TIER",
      after: { dryRun, models: results.length, totalDeleted },
      reason,
      correlationId,
    });

    return jsonOk({ dryRun, results });
  })(req);
}
