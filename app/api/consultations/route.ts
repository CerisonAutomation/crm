import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";

/**
 * Consultations — booking ledger with ICS invites.
 * GET  /api/consultations — role-scoped list (CLIENT own, staff org-wide).
 * POST /api/consultations — book one (consultation.write). Notify client + staff;
 *                           the .ics invite is served at /api/consultations/[id]/ics.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const base = { orderBy: { scheduledAt: "desc" as const }, take: 100 };
    if (ctx.role === "CLIENT") {
      const rows = await withTenantContext(ctx.orgId, (tx) =>
        tx.consultation.findMany({
          ...base,
          where: { orgId: ctx.orgId, leadEmail: ctx.email },
        })
      );
      return jsonOk({ consultations: rows });
    }
    const rows = await withTenantContext(ctx.orgId, (tx) =>
      tx.consultation.findMany({ ...base, where: { orgId: ctx.orgId } })
    );
    return jsonOk({ consultations: rows });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "consultation.write");

    const body = await readJson<{
      leadName?: string;
      leadEmail?: string;
      leadPhone?: string;
      programmeKey?: string;
      scheduledAt?: string;
      durationMin?: number;
      notes?: string;
    }>(r);
    if (!body.leadName || !body.leadEmail)
      throw new DomainError("leadName and leadEmail required", 400);
    const leadName: string = body.leadName;
    const leadEmail: string = body.leadEmail;
    if (!body.scheduledAt)
      throw new DomainError("scheduledAt required (ISO date)", 400);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime()))
      throw new DomainError("scheduledAt is not a valid date", 400);

    const consultation = await withTenantContext(ctx.orgId, (tx) =>
      tx.consultation.create({
        data: {
          orgId: ctx.orgId,
          leadName,
          leadEmail,
          leadPhone: body.leadPhone ?? null,
          programmeKey: body.programmeKey ?? null,
          scheduledAt,
          durationMin: body.durationMin ?? 45,
          status: "REQUESTED",
          notes: body.notes ?? null,
        },
      })
    );

    // If the lead maps to an existing client account, notify them + the calendar link.
    // Cross-org note: matched by email globally (pre-existing product behavior
    // for walk-in bookings); the created consultation itself is tenant-bound.
    // Under RLS the lookup below resolves inside the caller org.
    const clientUser = await withTenantContext(ctx.orgId, (tx) =>
      tx.user.findUnique({ where: { email: leadEmail }, select: { id: true } })
    );
    if (clientUser) {
      const when =
        scheduledAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
      await notifyUser({
        userId: clientUser.id,
        title: "Consultation requested",
        body: `${body.leadName} — ${when}. Invite: /api/consultations/${consultation.id}/ics`,
        category: "CASE",
      }).catch(() => undefined);
    }

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "consultation.booked",
      target: body.leadEmail,
      after: {
        scheduledAt: scheduledAt.toISOString(),
        programmeKey: body.programmeKey ?? null,
      },
      correlationId,
    });

    // Canonical hook: every PUBLISHED workflow subscribed to
    // trigger.consultation.booked starts now (fire-and-forget — a failing run
    // never breaks the booking). dedupeKey = consultation id so a replayed
    // booking event starts exactly one run per workflow.
    const { startRunsForTrigger } = await import(
      "@/lib/services/workflow-engine"
    );
    void startRunsForTrigger("trigger.consultation.booked", {
      trigger: "consultation.booked",
      context: {
        consultationId: consultation.id,
        leadName: consultation.leadName,
        leadEmail: consultation.leadEmail,
        programmeKey: consultation.programmeKey ?? undefined,
        scheduledAt: scheduledAt.toISOString(),
        durationMin: consultation.durationMin,
        icsUrl: `/api/consultations/${consultation.id}/ics`,
      },
      actorLabel: `${ctx.name} [${ctx.role}]`,
      correlationId,
      orgId: ctx.orgId,
      dedupeKey: consultation.id,
    }).catch(() => undefined);

    return jsonOk({ consultation }, 201);
  })(req);
}
