/**
 * Reconciliation service (Zenith blueprint §9 — ReconciliationRun, ReconciliationFinding).
 *
 * Runs reconciliation checks between internal records and external providers.
 */

import { db } from "../db";
import { notFound } from "../api-errors";

export interface ReconciliationRun {
  id: string;
  orgId: string;
  type: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  totalCount: number;
  matchCount: number;
  mismatchCount: number;
  error: string | null;
  createdAt: Date;
}

export interface ReconciliationFinding {
  id: string;
  runId: string;
  entityType: string;
  entityId: string;
  field: string | null;
  expected: string | null;
  actual: string | null;
  severity: string;
  status: string;
  createdAt: Date;
  orgId: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
}

/**
 * Start a new reconciliation run.
 */
export async function startReconciliation(
  orgId: string,
  type: string,
): Promise<ReconciliationRun> {
  return db.reconciliationRun.create({
    data: {
      orgId,
      type,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

/**
 * Get reconciliation runs for an organisation.
 */
export async function getReconciliationRuns(orgId: string): Promise<ReconciliationRun[]> {
  return db.reconciliationRun.findMany({
    where: { orgId },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Get a single reconciliation run.
 */
export async function getReconciliationRun(id: string): Promise<ReconciliationRun> {
  const run = await db.reconciliationRun.findUnique({ where: { id } });
  if (!run) throw notFound("Reconciliation run not found");
  return run;
}

/**
 * Complete a reconciliation run.
 */
export async function completeReconciliation(
  id: string,
  totalCount: number,
  matchCount: number,
  mismatchCount: number,
): Promise<ReconciliationRun> {
  return db.reconciliationRun.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      totalCount,
      matchCount,
      mismatchCount,
    },
  });
}

/**
 * Fail a reconciliation run.
 */
export async function failReconciliation(id: string, error: string): Promise<ReconciliationRun> {
  return db.reconciliationRun.update({
    where: { id },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      error,
    },
  });
}

/**
 * Add a finding to a reconciliation run.
 */
export async function addFinding(params: {
  runId: string;
  orgId?: string;
  entityType: string;
  entityId: string;
  field?: string;
  expected?: string;
  actual?: string;
  severity?: string;
}): Promise<ReconciliationFinding> {
  return db.reconciliationFinding.create({
    data: {
      runId: params.runId,
      orgId: params.orgId ?? (await getReconciliationRun(params.runId)).orgId,
      entityType: params.entityType,
      entityId: params.entityId,
      field: params.field ?? null,
      expected: params.expected ?? null,
      actual: params.actual ?? null,
      severity: params.severity ?? "WARNING",
    },
  });
}

/**
 * Get findings for a reconciliation run.
 */
export async function getFindings(runId: string, orgId: string): Promise<ReconciliationFinding[]> {
  return db.reconciliationFinding.findMany({
    where: { runId, orgId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all findings for an organisation.
 */
export async function getReconciliationFindings(orgId: string): Promise<ReconciliationFinding[]> {
  return db.reconciliationFinding.findMany({
    where: { run: { orgId } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Resolve a finding.
 */
export async function resolveFinding(id: string): Promise<ReconciliationFinding> {
  return db.reconciliationFinding.update({
    where: { id },
    data: { status: "RESOLVED" },
  });
}
