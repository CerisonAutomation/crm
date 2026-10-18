import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { createSLAClock } from "@/lib/services/sla";
import { DSAR_SLA_HOURS, dsarClockName } from "@/lib/services/dsar-bundle";

export const dynamic = "force-dynamic";

const KINDS = ["EXPORT", "RECTIFY", "ERASE", "RESTRICT", "PORTABILITY"];

// GET /api/privacy/requests — mine; staff see their organisation's (?all=1 with case.read.all).
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const all = new URL(r.url).searchParams.get("all") === "1";
    if (all) requireCapability(ctx, "case.read.all");
    // GdprRequest has no orgId of its own — it is scoped through its owner user.
    const where = all
      ? { userId: { in: await orgUserIds(ctx.orgId) } }
      : { userId: ctx.userId };
    const requests = await db.gdprRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return jsonOk({ requests });
  })(req);
}

/** Ids of every user in one organisation — used to scope rows with no orgId column. */
async function orgUserIds(orgId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { orgId },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

// POST /api/privacy/requests { kind, detail? } — file a GDPR ticket (self only).
// PATCH /api/privacy/requests { id, status } — staff triage.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ kind?: unknown; detail?: unknown }>(r);
    if (typeof body.kind !== "string" || !KINDS.includes(body.kind))
      throw new DomainError("Unknown request kind", 400);
    const created = await db.gdprRequest.create({
      data: {
        userId: ctx.userId,
        kind: body.kind,
        detail:
          typeof body.detail === "string" ? body.detail.slice(0, 2000) : "",
      },
    });
    // DSAR countdown: EXPORT/PORTABILITY answers carry a 30-day SLA clock
    // (Art. 12(3)). Best-effort here so a clock failure can never lose the
    // ticket itself; the failure is audited for the sweeper to backfill.
    if (body.kind === "EXPORT" || body.kind === "PORTABILITY") {
      try {
        await createSLAClock({
          orgId: ctx.orgId,
          name: dsarClockName(created.id),
          targetHours: DSAR_SLA_HOURS,
        });
      } catch (e: unknown) {
        await audit({
          orgId: ctx.orgId,
          action: "privacy.sla.start_failed",
          target: created.id,
          actorId: ctx.userId,
          actorLabel: ctx.name,
          reason:
            e instanceof Error ? e.message.slice(0, 300) : "clock start failed",
        });
      }
    }
    await audit({
      orgId: ctx.orgId,
      action: "privacy.request",
      target: body.kind,
      actorId: ctx.userId,
      actorLabel: ctx.name,
      after: { id: created.id },
    });
    return jsonOk({ request: created });
  })(req);
}

export async function PATCH(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    // Triage is a lifecycle WRITE on another user's ticket — the request
    // capability, not a read. The read capability is held by the read-only
    // AUDITOR, who must never be able to change a ticket's status.
    requireCapability(ctx, "request.create");
    const body = await readJson<{ id?: unknown; status?: unknown }>(r);
    if (typeof body.id !== "string") throw new DomainError("id required", 400);
    if (
      !["OPEN", "IN_PROGRESS", "FULFILLED", "REJECTED"].includes(
        String(body.status)
      )
    ) {
      throw new DomainError("Bad status", 400);
    }
    // Tenant/ownership gate: staff may only triage their own ticket or one whose
    // owner belongs to their organisation. Anything else is reported as missing.
    const target = await db.gdprRequest.findUnique({
      where: { id: body.id },
      select: { id: true, userId: true },
    });
    if (!target) throw new DomainError("Request not found", 404);
    if (target.userId !== ctx.userId) {
      const owner = await db.user.findUnique({
        where: { id: target.userId },
        select: { orgId: true },
      });
      if (!owner || owner.orgId !== ctx.orgId)
        throw new DomainError("Request not found", 404);
    }
    const saved = await db.gdprRequest.update({
      where: { id: body.id },
      data: { status: String(body.status) },
    });
    await audit({
      orgId: ctx.orgId,
      action: "privacy.request.triage",
      target: saved.id,
      actorId: ctx.userId,
      actorLabel: ctx.name,
      after: { status: saved.status },
    });
    return jsonOk({ request: saved });
  })(req);
}
