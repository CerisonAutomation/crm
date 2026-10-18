import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// ── Proactive Trigger Evaluation ────────────────────────────────

export async function evaluateProactiveTriggers(params: {
  orgId: string;
  event: string;
  caseId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const triggers = await db.proactiveTrigger.findMany({
      where: { orgId: params.orgId, event: params.event, active: true },
    });
  
    const results: Array<{ id: string; status: string }> = [];
    for (const trigger of triggers) {
      const action = await db.proactiveAction.create({
        data: {
          triggerId: trigger.id,
          orgId: params.orgId,
          caseId: params.caseId,
          status: "pending",
          result: { triggerName: trigger.name, action: trigger.action },
        },
      });
      results.push({ id: action.id, status: action.status });
    }

  return results;
}

// ── Execute Proactive Action ────────────────────────────────────

export async function executeProactiveAction(actionId: string) {
  const action = await db.proactiveAction.findUnique({
    where: { id: actionId },
    include: { trigger: true },
  });

  if (!action) return null;

  let result: Prisma.InputJsonValue = {};

  switch (action.trigger.action) {
    case "run_prediction":
      result = { message: "Prediction triggered", caseId: action.caseId };
      break;
    case "send_notification":
      result = { message: "Notification sent", caseId: action.caseId };
      break;
    case "create_task":
      result = { message: "Task created", caseId: action.caseId };
      break;
    case "escalate":
      result = { message: "Case escalated", caseId: action.caseId };
      break;
    default:
      result = { message: "Unknown action type" };
  }

  return db.proactiveAction.update({
    where: { id: actionId },
    data: {
      status: "completed",
      result,
      completedAt: new Date(),
    },
  });
}

// ── Translation Service ─────────────────────────────────────────

export async function translateText(params: {
  orgId: string;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  formality?: "default" | "formal" | "informal";
}) {
  // Check translation memory first
  const memory = await db.translationMemory.findFirst({
    where: {
      orgId: params.orgId,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      sourceText: params.sourceText,
    },
  });

  if (memory) {
    return {
      translatedText: memory.targetText,
      source: "memory",
      formality: params.formality ?? "default",
    };
  }

  // Create translation job
  const job = await db.translationJob.create({
    data: {
      orgId: params.orgId,
      sourceText: params.sourceText,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      formality: params.formality ?? "default",
      status: "pending",
    },
  });

  // In a real implementation, this would call an AI translation service
  // For now, we mark it as pending
  return {
    jobId: job.id,
    status: "pending",
    message: "Translation job created",
  };
}

// ── Review Translation ───────────────────────────────────────────

export async function reviewTranslation(params: {
  jobId: string;
  translatedText: string;
  reviewedBy: string;
}) {
  const job = await db.translationJob.update({
    where: { id: params.jobId },
    data: {
      translatedText: params.translatedText,
      status: "completed",
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      completedAt: new Date(),
    },
  });

  // Add to translation memory
  await db.translationMemory.create({
    data: {
      orgId: job.orgId,
      sourceLang: job.sourceLang,
      targetLang: job.targetLang,
      sourceText: job.sourceText,
      targetText: params.translatedText,
    },
  });

  return job;
}

// ── Get Translation Memory ──────────────────────────────────────

export async function getTranslationMemory(
  orgId: string,
  sourceLang: string,
  targetLang: string
) {
  return db.translationMemory.findMany({
    where: { orgId, sourceLang, targetLang },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// ── Get Pending Translation Jobs ─────────────────────────────────

export async function getPendingTranslationJobs(orgId: string) {
  return db.translationJob.findMany({
    where: { orgId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}

// ── AI Tool Management ──────────────────────────────────────────

export async function getAiTools(orgId: string, category?: string) {
  return db.aiTool.findMany({
    where: { orgId, active: true, ...(category ? { category } : undefined) },
  });
}

export async function createAiTool(params: {
  orgId: string;
  name: string;
  description?: string;
  category: string;
  config?: Prisma.InputJsonValue;
}) {
  return db.aiTool.create({
    data: {
      orgId: params.orgId,
      name: params.name,
      description: params.description,
      category: params.category,
      config: params.config,
    },
  });
}
