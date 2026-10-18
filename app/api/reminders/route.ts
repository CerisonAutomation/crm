import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { lastSweep, runSweep, scheduleReminder, type ReminderKind } from "@/lib/services/reminders";

// GET /api/reminders — role-scoped deadline ledger.
// CLIENT: reminders tied to their cases. RM/SENIOR_RM/ADMIN: org-wide.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const url = new URL(r.url);
    const kind = url.searchParams.get("kind");
    const status = url.searchParams.get("status");
    const caseId = url.searchParams.get("caseId");
    const take = Math.min(Number(url.searchParams.get("take") ?? 100), 200);

    const isStaff = ctx.role !== "CLIENT";
    // Every staff role — ADMIN included — is scoped to the caller's organisation;
    // an empty filter would have returned other tenants' deadline items.
    const where = {
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(caseId ? { caseId } : {}),
      ...(isStaff ? { case: { orgId: ctx.orgId } } : { case: { clientId: ctx.userId } }),
    };
    const reminders = await db.reminder.findMany({
      where,
      include: { case: { select: { id: true, reference: true, clientId: true } } },
      orderBy: { dueAt: "asc" },
      take,
    });
    return jsonOk({ reminders, lastSweep: lastSweep() });
  })(req);
}

// POST /api/reminders — create a custom reminder (RM+) or run the sweeper (ADMIN).
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ action?: "create" | "sweep"; caseId?: string; kind?: ReminderKind; title?: string; detail?: string; dueAt?: string; audience?: "CLIENT" | "RM" | "BOTH" }>(r);

    if (body.action === "sweep") {
      requireCapability(ctx, "reminder.manage");
      const result = await runSweep();
      await db.auditEvent.create({
        data: { orgId: ctx.orgId, actorLabel: ctx.name, action: "reminder.sweep", target: "reminder-ledger", after: JSON.stringify(result) },
      }).catch(() => undefined);
      return jsonOk({ swept: result });
    }

    requireCapability(ctx, "reminder.manage");
    if (!body.caseId || !body.title || !body.dueAt) throw new DomainError("caseId, title and dueAt are required", 400);
        const kase = await db.case.findUnique({ where: { id: body.caseId }, select: { id: true, reference: true, clientId: true, orgId: true } });
        // Tenant isolation for every staff role, ADMIN included.
        if (!kase || kase.orgId !== ctx.orgId) throw new DomainError("Case not found", 404);
        const dueAt = new Date(body.dueAt);
        if (Number.isNaN(dueAt.getTime())) throw new DomainError("Invalid dueAt", 400);

    const res = await scheduleReminder({
      caseId: kase.id,
      clientId: kase.clientId,
      kind: body.kind ?? "CUSTOM",
      title: body.title,
      detail: body.detail,
      dueAt,
      audience: body.audience ?? "BOTH",
      dedupeKey: `custom:${kase.id}:${body.title}:${dueAt.getTime()}`,
      metadata: { createdBy: ctx.userId },
    });
    await db.auditEvent.create({
      data: {
        orgId: ctx.orgId, actorLabel: ctx.name, action: "reminder.created", target: kase.reference,
        after: JSON.stringify({ title: body.title, dueAt: dueAt.toISOString(), created: res.created }),
      },
    }).catch(() => undefined);
    return jsonOk(res);
  })(req);
}
