import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";

/**
 * Obligation ledger — permit renewals, filings, deadlines.
 * GET   /api/renewals — role-scoped list (CLIENT own, staff org-wide).
 * POST  /api/renewals — schedule one (renewal.write): notifies client + assigned staff.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const args = {
      orderBy: { dueAt: "asc" as const },
      take: 200,
      include: { case: { select: { reference: true, clientId: true } } },
    };
    if (ctx.role === "CLIENT") {
      const renewals = await withTenantContext(ctx.orgId, (tx) =>
        tx.renewalReminder.findMany({
          ...args,
          where: { clientId: ctx.userId },
        })
      );
      return jsonOk({ renewals });
    }
    const renewals = await withTenantContext(ctx.orgId, (tx) =>
      tx.renewalReminder.findMany({ ...args, where: { orgId: ctx.orgId } })
    );
    return jsonOk({ renewals });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "renewal.write");

    const body = await readJson<{
      caseId?: string;
      kind?: string;
      title?: string;
      dueAt?: string;
      remindInDays?: number;
      notes?: string;
    }>(r);
    // ADR-006: unhappy-first validation through the pure domain (strangler -
    // the write path below is unchanged; this only rejects bad input early).
    const { validateScheduleRenewal } = await import("@/lib/domain/renewals");
    const problems = validateScheduleRenewal({
      kind: body.kind,
      title: body.title,
      dueAt: body.dueAt,
      remindInDays: body.remindInDays,
    });
    if (problems.length > 0) throw new DomainError(problems.join("; "), 400);
    if (!body.title || !body.dueAt)
      throw new DomainError("title and dueAt are required", 400);
    const title: string = body.title;
    const dueAt = new Date(body.dueAt);

    let clientId = ctx.userId;
    let caseRef: string | null = null;
    let caseId: string | null = null;
    if (body.caseId) {
      const kase = await withTenantContext(ctx.orgId, (tx) =>
        tx.case.findUnique({
          where: { id: body.caseId },
          select: { id: true, reference: true, clientId: true, orgId: true },
        })
      );
      if (!kase || kase.orgId !== ctx.orgId)
        throw new DomainError("Case not in your organisation", 403);
      clientId = kase.clientId;
      caseRef = kase.reference;
      caseId = kase.id;
    }

    const remindAt =
      body.remindInDays !== null && body.remindInDays !== undefined
        ? new Date(dueAt.getTime() - body.remindInDays * 86_400_000)
        : new Date(dueAt.getTime() - 7 * 86_400_000);

    const renewal = await withTenantContext(ctx.orgId, (tx) =>
      tx.renewalReminder.create({
        data: {
          orgId: ctx.orgId,
          caseId,
          clientId,
          kind: body.kind ?? "PERMIT_RENEWAL",
          title,
          notes: body.notes ?? null,
          dueAt,
          remindAt: remindAt > new Date() ? remindAt : null,
          status: remindAt > new Date() ? "OPEN" : "SCHEDULED",
        },
      })
    );

    // Notify the applicant + assigned staff immediately when already inside the window.
    const when = dueAt.toISOString().slice(0, 10);
    await notifyUser({
      userId: clientId,
      title: caseRef ? `${body.title} — case ${caseRef}` : body.title,
      body: `Deadline ${when}. Plan the renewal ahead — documents and government fees take time.`,
      category: "CASE",
      caseId: caseId ?? undefined,
    }).catch(() => undefined);
    if (caseId) {
      const staff = (
        await withTenantContext(ctx.orgId, (tx) =>
          tx.caseAssignment.findMany({
            where: { caseId },
            select: { userId: true },
          })
        )
      ).map((a) => a.userId);
      for (const userId of staff) {
        await notifyUser({
          userId,
          title: `Renewal scheduled — ${caseRef}`,
          body: `${body.title} due ${when}.`,
          category: "CASE",
          caseId,
        }).catch(() => undefined);
      }
    }

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "renewal.scheduled",
      target: body.title,
      after: { dueAt: when, kind: body.kind ?? "PERMIT_RENEWAL" },
      correlationId,
    });
    // ADR-006: durable aftercare fan-out - one automation-queue job (retry +
    // DLQ), one Reminder-ledger row and one RM task. Best-effort: the row
    // above is the truth and the 5-minute deadline sweep re-fires from it.
    {
      const { getRenewalPorts } = await import("@/lib/adapters/renewals");
      const { renewalDedupeKeys } = await import("@/lib/domain/renewals");
      const keys = renewalDedupeKeys(renewal.id);
      const record = {
        id: renewal.id,
        orgId: renewal.orgId,
        caseId: renewal.caseId,
        clientId: renewal.clientId,
        kind: renewal.kind,
        title: renewal.title,
        notes: renewal.notes,
        dueAt: renewal.dueAt,
        remindAt: renewal.remindAt,
        status: renewal.status,
      };
      const sink = getRenewalPorts().sink;
      const delayMs = renewal.remindAt
        ? Math.max(0, renewal.remindAt.getTime() - Date.now())
        : 0;
      await sink
        .enqueueReminderJob({ renewal: record, delayMs, dedupeKey: keys.job })
        .catch(() => undefined);
      await sink
        .scheduleClientReminder({
          renewal: record,
          dedupeKey: keys.job,
          dueAt: renewal.dueAt,
        })
        .catch(() => undefined);
      await sink
        .ensureRmTask({ renewal: record, marker: keys.task })
        .catch(() => undefined);
    }
    return jsonOk({ renewal }, 201);
  })(req);
}
