/**
 * Incident management service (Zenith blueprint §9 — Incident entity).
 *
 * Tracks operational incidents and their resolution.
 */

import { db } from "../db";
import { notFound } from "../api-errors";

export interface Incident {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  caseId?: string | null;
  rootCause?: string | null;
  resolvedBy: string | null;
}

/**
 * Create a new incident.
 */
export async function createIncident(params: {
  orgId: string;
  title: string;
  description?: string;
  severity?: string;
  assignedTo?: string;
}): Promise<Incident> {
  return db.incident.create({
    data: {
      orgId: params.orgId,
      title: params.title,
      description: params.description ?? "",
      severity: params.severity ?? "MEDIUM",
      status: "OPEN",
      assignedTo: params.assignedTo ?? null,
    },
  });
}

/**
 * Get incidents for an organisation.
 */
export async function getIncidents(orgId: string): Promise<Incident[]> {
  return db.incident.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a single incident.
 */
export async function getIncident(id: string): Promise<Incident> {
  const incident = await db.incident.findUnique({ where: { id } });
  if (!incident) throw notFound("Incident not found");
  return incident;
}

/**
 * Update incident status.
 */
export async function updateIncidentStatus(
  id: string,
  status: string,
): Promise<Incident> {
  const incident = await db.incident.findUnique({ where: { id } });
  if (!incident) throw notFound("Incident not found");
  return db.incident.update({
    where: { id },
    data: { status },
  });
}

/**
 * Resolve an incident.
 */
export async function resolveIncident(
  id: string,
  userId: string,
  orgId: string,
  resolution: string,
): Promise<Incident> {
  const incident = await db.incident.findFirst({ where: { id, orgId } });
  if (!incident) throw notFound("Incident not found");
  return db.incident.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolution,
      resolvedBy: userId,
    },
  });
}

/**
 * Assign an incident to a user.
 */
export async function assignIncident(id: string, userId: string): Promise<Incident> {
  const incident = await db.incident.findUnique({ where: { id } });
  if (!incident) throw notFound("Incident not found");
  return db.incident.update({
    where: { id },
    data: { assignedTo: userId },
  });
}
