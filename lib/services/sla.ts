/**
 * SLA tracking service (Zenith blueprint §9 — SLAClock entity).
 *
 * Tracks service-level agreement deadlines for cases. Each SLA clock
 * has a target duration, a deadline, and a status (ACTIVE | MET | BREACHED | PAUSED).
 */

import { db } from "../db";
import { conflict, notFound, validationFailed } from "../api-errors";
import { audit } from "../api-helpers";

/**
 * Declared pause reasons (§24.6) — a clock pauses ONLY for one of these.
 * Free-text reasons are rejected: breach accounting must stay comparable
 * across cases, and a prose reason hides gaming (pausing to stop the clock
 * without a legitimate wait).
 */
export const SLA_PAUSE_REASONS = [
  "AWAITING_CLIENT",
  "AWAITING_AUTHORITY",
  "CLIENT_REQUEST",
  "FORCE_MAJEURE",
  "PENDING_DOCUMENTS",
] as const;

export type SLAPauseReason = (typeof SLA_PAUSE_REASONS)[number];

export function isPauseReason(reason: unknown): reason is SLAPauseReason {
  return (
    typeof reason === "string" &&
    (SLA_PAUSE_REASONS as readonly string[]).includes(reason)
  );
}

export interface SLAClock {
  id: string;
  orgId: string;
  caseId: string | null;
  name: string;
  targetHours: number;
  startedAt: Date;
  deadlineAt: Date;
  status: string;
  pausedAt: Date | null;
  pausedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create a new SLA clock for a case.
 */
export async function createSLAClock(params: {
  orgId: string;
  caseId?: string;
  name: string;
  targetHours: number;
}): Promise<SLAClock> {
  const deadline = new Date(Date.now() + params.targetHours * 60 * 60 * 1000);
  return db.sLAClock.create({
    data: {
      orgId: params.orgId,
      caseId: params.caseId ?? null,
      name: params.name,
      targetHours: params.targetHours,
      startedAt: new Date(),
      deadlineAt: deadline,
      status: "ACTIVE",
    },
  });
}

/**
 * Get all SLA clocks for an organisation, optionally filtered by case.
 */
export async function getSLAClocks(
  orgId: string,
  caseId?: string
): Promise<SLAClock[]> {
  return db.sLAClock.findMany({
    where: {
      orgId,
      ...(caseId ? { caseId } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Check for breached SLA clocks and update their status. Each breach is
 * audit-logged (sla.breached) with the overdue span — the sweep runs on the
 * shared cadence (cron tick), so the audit row, not the response, is the
 * durable record staff reviews.
 */
export async function checkSLABreaches(orgId: string): Promise<number> {
  const now = new Date();
  const overdue = await db.sLAClock.findMany({
    where: { orgId, status: "ACTIVE", deadlineAt: { lt: now } },
    select: { id: true, name: true, caseId: true, deadlineAt: true },
    take: 100,
  });
  if (overdue.length === 0) return 0;
  await db.sLAClock.updateMany({
    where: { id: { in: overdue.map((c) => c.id) } },
    data: { status: "BREACHED" },
  });
  for (const c of overdue) {
    const overdueMs = now.getTime() - c.deadlineAt.getTime();
    await audit({
      orgId,
      actorLabel: "sla-sweep",
      action: "sla.breached",
      target: c.id,
      after: {
        name: c.name,
        caseId: c.caseId,
        overdueHours: Math.round(overdueMs / 3_600_000),
      },
    });
  }
  return overdue.length;
}

/**
 * Sweep every organisation (shared-cadence entrypoint for cron tick).
 * Returns the total breached count; per-org failures are contained so one
 * tenant can never stall the sweep for the rest.
 */
export async function checkAllSLABreaches(): Promise<{
  breached: number;
  orgs: number;
}> {
  const orgs = await db.organisation
    .findMany({ select: { id: true } })
    .catch(() => []);
  let breached = 0;
  for (const org of orgs) {
    try {
      breached += await checkSLABreaches(org.id);
    } catch (err) {
      console.error(`[sla] breach sweep failed for org ${org.id}`, err);
    }
  }
  return { breached, orgs: orgs.length };
}

/**
 * Mark an SLA clock as met.
 */
export async function markSLAMet(id: string, orgId: string): Promise<SLAClock> {
  const clock = await db.sLAClock.findFirst({ where: { id, orgId } });
  if (!clock) throw notFound("SLA clock not found");
  return db.sLAClock.update({
    where: { id },
    data: { status: "MET" },
  });
}

/**
 * Pause an SLA clock — ACTIVE only, declared reason only, tenant-scoped.
 * A paused clock stops accruing breach: checkSLABreaches only flips ACTIVE
 * rows, so the pause window is Breach-neutral by construction.
 */
export async function pauseSLA(
  id: string,
  orgId: string,
  reason: unknown,
  actorLabel?: string
): Promise<SLAClock> {
  if (!isPauseReason(reason)) {
    throw validationFailed(
      `Pause reason must be one of: ${SLA_PAUSE_REASONS.join(", ")}`
    );
  }
  const clock = await db.sLAClock.findFirst({ where: { id, orgId } });
  if (!clock) throw notFound("SLA clock not found");
  if (clock.status !== "ACTIVE")
    throw conflict(`Only an ACTIVE clock can pause (status: ${clock.status})`);
  const updated = await db.sLAClock.update({
    where: { id },
    data: { status: "PAUSED", pausedAt: new Date(), pausedReason: reason },
  });
  await audit({
    orgId,
    actorLabel: actorLabel ?? "staff",
    action: "sla.paused",
    target: id,
    after: { name: clock.name, caseId: clock.caseId, reason },
  });
  return updated;
}

/**
 * Resume a paused SLA clock with breach recalculation: the deadline shifts
 * forward by exactly the paused span, so the pause neither refunds nor
 * steals time — the clock owes the same remaining duration as when paused.
 */
export async function resumeSLA(
  id: string,
  orgId: string,
  actorLabel?: string,
  now = new Date()
): Promise<SLAClock> {
  const clock = await db.sLAClock.findFirst({ where: { id, orgId } });
  if (!clock) throw notFound("SLA clock not found");
  if (clock.status !== "PAUSED")
    throw conflict(`Only a PAUSED clock can resume (status: ${clock.status})`);
  const pausedMs = Math.max(
    0,
    now.getTime() - (clock.pausedAt?.getTime() ?? now.getTime())
  );
  const updated = await db.sLAClock.update({
    where: { id },
    data: {
      status: "ACTIVE",
      deadlineAt: new Date(clock.deadlineAt.getTime() + pausedMs),
      pausedAt: null,
      pausedReason: null,
    },
  });
  await audit({
    orgId,
    actorLabel: actorLabel ?? "staff",
    action: "sla.resumed",
    target: id,
    after: {
      name: clock.name,
      caseId: clock.caseId,
      pausedHours: Math.round(pausedMs / 3_600_000),
      deadlineAt: updated.deadlineAt.toISOString(),
    },
  });
  return updated;
}
