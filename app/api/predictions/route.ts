import { z } from "zod";
import { handler, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  scoreCaseRisk,
  getCasePredictions,
  reviewPrediction,
  expirePredictions,
  getActiveInterventions,
  createIntervention,
} from "@/lib/services/predictive";

export const GET = handler(async (req) => {
  const ctx = await requireAuth(req);
  requireCapability(ctx, "case.read.all");
  const { orgId } = ctx;
  const { searchParams } = new URL(req.url);
  const caseId = searchParams.get("caseId");

  if (caseId) {
    const predictions = await getCasePredictions(orgId, caseId);
    return Response.json(predictions);
  }

  const interventions = await getActiveInterventions(orgId);
  return Response.json(interventions);
});

const PostBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("score_case_risk"), caseId: z.string().min(1).max(128) }),
  z.object({
    action: z.literal("review_prediction"),
    predictionId: z.string().min(1).max(128),
    outcome: z.enum(["confirmed", "refuted", "partial"]),
    notes: z.string().max(2000).optional(),
  }),
  z.object({ action: z.literal("expire_predictions") }),
  z.object({
    action: z.literal("create_intervention"),
    type: z.enum(["manual_review", "escalation", "auto_action", "notification"]),
    interventionAction: z.string().min(1).max(200).optional(),
    caseId: z.string().min(1).max(128).optional(),
    predictionId: z.string().min(1).max(128).optional(),
  }),
]);

export const POST = handler(async (req) => {
  const ctx = await requireAuth(req);
  // Every POST action below creates or mutates prediction/intelligence rows —
  // a lifecycle write the read-only AUDITOR (case.read.all) must never reach.
  requireCapability(ctx, "triage.run");
  const { orgId, userId } = ctx;
  const raw = await readJson<unknown>(req);
  const parsed = PostBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(`Invalid request body: ${parsed.error.issues.map((e) => e.message).join(", ")}`, 400);
  }
  const body = parsed.data;

  switch (body.action) {
    case "score_case_risk": {
      const prediction = await scoreCaseRisk({ orgId, caseId: body.caseId });
      await audit({ orgId, actorId: userId, action: "prediction.scored", target: body.caseId });
      return Response.json(prediction);
    }
    case "review_prediction": {
      // orgId-scoped inside the service: a prediction from another tenant
      // matches nothing and fails closed with 404 (no IDOR flip).
      const prediction = await reviewPrediction({ orgId, predictionId: body.predictionId, outcome: body.outcome, reviewedBy: userId, notes: body.notes });
      return Response.json(prediction);
    }
    case "expire_predictions": {
      const result = await expirePredictions(orgId);
      await audit({ orgId, actorId: userId, action: "prediction.expired", target: orgId });
      return Response.json(result);
    }
    case "create_intervention": {
      const intervention = await createIntervention({
        orgId,
        caseId: body.caseId,
        predictionId: body.predictionId,
        type: body.type,
        action: body.interventionAction ?? body.action,
        createdBy: userId,
      });
      await audit({ orgId, actorId: userId, action: "intervention.created", target: body.caseId ?? body.predictionId ?? orgId });
      return Response.json(intervention);
    }
  }
});
