import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

/**
 * PATCH /api/renewals/[id] — obligation ledger lifecycle:
 *   DONE (renewal filed), CANCELLED, or reschedule (dueAt/notes update)
 *   via renewal.write; date confirmation (`{ confirm: true }`) via
 *   renewal.write (staff) or renewal.confirm.own (the client) — ADR-006:
 *   only confirmed dates go on the radar.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);

    const renewal = await withTenantContext(ctx.orgId, (tx) =>
      tx.renewalReminder.findUnique({ where: { id } })
    );
    if (!renewal || renewal.orgId !== ctx.orgId)
      throw new DomainError("Renewal not found", 404);

    const body = await readJson<{
      status?: string;
      dueAt?: string;
      notes?: string;
      confirm?: boolean;
    }>(r);

    // ADR-006 confirm path: the client confirms their own proposed date (or
    // staff confirm on their behalf). Routes through the pure use case.
    if (body.confirm === true) {
      const isStaff = ctx.role !== "CLIENT";
      requireCapability(ctx, isStaff ? "renewal.write" : "renewal.confirm.own");
      const { getRenewalPorts } = await import("@/lib/adapters/renewals");
      const { confirmRenewal } = await import("@/lib/services/renewal-track");
      const res = await confirmRenewal(
        getRenewalPorts(),
        {
          userId: ctx.userId,
          orgId: ctx.orgId,
          staff: isStaff,
          label: `${ctx.name} [${ctx.role}]`,
        },
        id
      );
      if (!res.ok) throw new DomainError(res.errors.join("; "), 400);
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "renewal.confirmed",
        target: renewal.title,
        before: { status: renewal.status },
        after: { status: res.renewal.status },
        correlationId,
      });
      return jsonOk({ renewal: res.renewal });
    }

    requireCapability(ctx, "renewal.write");
    const data: { status?: string; dueAt?: Date; notes?: string } = {};
    if (body.status) {
      if (!["OPEN", "SCHEDULED", "DONE", "CANCELLED"].includes(body.status)) {
        throw new DomainError("Invalid status", 400);
      }
      data.status = body.status;
    }
    if (body.dueAt) {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime()))
        throw new DomainError("dueAt is not a valid date", 400);
      data.dueAt = d;
    }
    if (body.notes !== undefined) data.notes = body.notes;

    const updated = await withTenantContext(ctx.orgId, (tx) =>
      tx.renewalReminder.update({ where: { id }, data })
    );
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "renewal.updated",
      target: renewal.title,
      before: { status: renewal.status },
      after: { status: updated.status },
      correlationId,
    });
    return jsonOk({ renewal: updated });
  })(req);
}
