import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/lib/domain/states";
import { audit } from "@/lib/api-helpers";

// ── Signal Recording ────────────────────────────────────────────

export async function recordSignalObservation(params: {
  orgId: string;
  signalKey: string;
  caseId?: string;
  value: number;
  metadata?: Prisma.InputJsonValue;
}) {
  const signal = await db.signalDefinition.findFirst({
    where: { orgId: params.orgId, key: params.signalKey },
  });
  if (!signal) return null;

  return db.signalObservation.create({
    data: {
      orgId: params.orgId,
      signalId: signal.id,
      caseId: params.caseId,
      value: params.value,
      metadata: params.metadata,
    },
  });
}

// ── Feature Snapshots ───────────────────────────────────────────

export async function buildFeatureSnapshot(params: {
  orgId: string;
  caseId?: string;
  features: Prisma.InputJsonValue;
}) {
  return db.featureSnapshot.create({
    data: {
      orgId: params.orgId,
      caseId: params.caseId,
      features: params.features,
    },
  });
}

// ── Case Risk Scoring ───────────────────────────────────────────

export async function scoreCaseRisk(params: {
  orgId: string;
  caseId: string;
}) {
  // Tenant ownership first: scoring another organisation's case must fail
  // closed instead of minting a cross-tenant prediction row.
  const kase = await db.case.findFirst({
    where: { id: params.caseId, orgId: params.orgId },
    select: { id: true },
  });
  if (!kase) throw new DomainError("Case not found", 404);
  const signals = await db.signalDefinition.findMany({
    where: { orgId: params.orgId, active: true, category: "case" },
  });

  const observations = await db.signalObservation.findMany({
    where: { orgId: params.orgId, caseId: params.caseId },
    orderBy: { observedAt: "desc" },
    take: signals.length * 2,
  });

  let totalWeight = 0;
  let weightedScore = 0;

  for (const signal of signals) {
    const obs = observations.find((o) => o.signalId === signal.id);
    if (!obs) continue;

    let normalized = obs.value;
    if (signal.direction === "lower_is_riskier") {
      normalized = 1 - normalized;
    }

    weightedScore += normalized * signal.weight;
    totalWeight += signal.weight;
  }

  const score = totalWeight > 0 ? weightedScore / totalWeight : 0.5;
  const confidence = Math.min(1, observations.length / Math.max(signals.length, 1));

  const prediction = await db.prediction.create({
    data: {
      orgId: params.orgId,
      caseId: params.caseId,
      type: "case_risk",
      score,
      confidence,
      features: { signalCount: signals.length, observationCount: observations.length },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return prediction;
}

// ── Next Best Action ────────────────────────────────────────────

export async function generateNextBestAction(params: {
  orgId: string;
  caseId: string;
}) {
  const caseData = await db.case.findUnique({
    where: { id: params.caseId },
    include: {
      documents: true,
      workItems: true,
      events: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!caseData) return null;

  const predictions = await db.prediction.findMany({
    where: { orgId: params.orgId, caseId: params.caseId, status: "active" },
    orderBy: { score: "desc" },
    take: 3,
  });

  const actions: string[] = [];

  if (caseData.status === "intake") {
    actions.push("Review submitted documents for completeness");
  }
  if (caseData.status === "review" && caseData.documents.length === 0) {
    actions.push("Request missing documents from client");
  }
  if (predictions.some((p) => p.type === "case_risk" && p.score > 0.7)) {
    actions.push("Escalate to senior reviewer due to high risk score");
  }
  if (caseData.workItems.some((t) => t.status === "OPEN" && t.dueDate && t.dueDate < new Date())) {
    actions.push("Follow up on overdue tasks");
  }

  return {
    caseId: params.caseId,
    actions,
    predictions,
    generatedAt: new Date(),
  };
}

// ── Prediction Review ───────────────────────────────────────────

export async function reviewPrediction(params: {
  orgId: string;
  predictionId: string;
  outcome: "confirmed" | "refuted" | "partial";
  reviewedBy: string;
  notes?: string;
}) {
  // IDOR guard: the prediction must belong to the caller's organisation.
  // A foreign id matches nothing and fails closed with 404 — it can never be
  // flipped, confirmed, or refuted cross-tenant.
  const existing = await db.prediction.findFirst({
    where: { id: params.predictionId, orgId: params.orgId },
    select: { id: true },
  });
  if (!existing) throw new DomainError("Prediction not found", 404);
  const prediction = await db.prediction.update({
    where: { id: existing.id },
    data: {
      status: params.outcome === "confirmed" ? "confirmed" : params.outcome === "refuted" ? "refuted" : "reviewed",
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
    },
  });

  await db.predictionFeedback.create({
    data: {
      predictionId: existing.id,
      outcome: params.outcome,
      notes: params.notes,
    },
  });

  await audit({
    orgId: params.orgId,
    actorId: params.reviewedBy,
    action: "prediction.reviewed",
    target: existing.id,
    after: { outcome: params.outcome },
  });

  return prediction;
}

// ── Expire Predictions ──────────────────────────────────────────

export async function expirePredictions(orgId: string) {
  const now = new Date();
  return db.prediction.updateMany({
    where: {
      orgId,
      status: "active",
      expiresAt: { lt: now },
    },
    data: { status: "expired" },
  });
}

// ── Create Intervention ─────────────────────────────────────────

export async function createIntervention(params: {
  orgId: string;
  caseId?: string;
  predictionId?: string;
  type: "manual_review" | "escalation" | "auto_action" | "notification";
  action: string;
  createdBy?: string;
}) {
  // Tenant ownership on every link: an intervention must never attach to a
  // foreign case or a foreign prediction (cross-tenant write primitive).
  if (params.caseId) {
    const kase = await db.case.findFirst({
      where: { id: params.caseId, orgId: params.orgId },
      select: { id: true },
    });
    if (!kase) throw new DomainError("Case not found", 404);
  }
  if (params.predictionId) {
    const prediction = await db.prediction.findFirst({
      where: { id: params.predictionId, orgId: params.orgId },
      select: { id: true },
    });
    if (!prediction) throw new DomainError("Prediction not found", 404);
  }
  const intervention = await db.intervention.create({
    data: {
      orgId: params.orgId,
      caseId: params.caseId,
      predictionId: params.predictionId,
      type: params.type,
      action: params.action,
      createdBy: params.createdBy,
    },
  });
  await audit({
    orgId: params.orgId,
    actorId: params.createdBy ?? null,
    action: "intervention.created",
    target: params.caseId ?? params.predictionId ?? params.orgId,
    after: { type: params.type },
  });
  return intervention;
}

// ── Get Predictions for Case ────────────────────────────────────

export async function getCasePredictions(orgId: string, caseId: string) {
  return db.prediction.findMany({
    where: { orgId, caseId },
    orderBy: { createdAt: "desc" },
    include: { feedback: true },
  });
}

// ── Get Active Interventions ────────────────────────────────────

export async function getActiveInterventions(orgId: string, caseId?: string) {
  return db.intervention.findMany({
    where: {
      orgId,
      status: "pending",
      ...(caseId ? { caseId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
