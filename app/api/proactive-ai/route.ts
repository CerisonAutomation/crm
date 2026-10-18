import { handler } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import {
  evaluateProactiveTriggers,
  executeProactiveAction,
  translateText,
  reviewTranslation,
  getTranslationMemory,
  getPendingTranslationJobs,
  getAiTools,
  createAiTool,
} from "@/lib/services/proactive-ai";

export const GET = handler(async (req) => {
  const { orgId } = await requireAuth(req);
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const sourceLang = searchParams.get("sourceLang");
  const targetLang = searchParams.get("targetLang");

  if (sourceLang && targetLang) {
    const memory = await getTranslationMemory(orgId, sourceLang, targetLang);
    return Response.json(memory);
  }

  if (category === "tools") {
    const tools = await getAiTools(orgId);
    return Response.json(tools);
  }

  if (category === "pending_translations") {
    const jobs = await getPendingTranslationJobs(orgId);
    return Response.json(jobs);
  }

  const tools = await getAiTools(orgId);
  return Response.json(tools);
});

export const POST = handler(async (req) => {
  const { orgId, userId } = await requireAuth(req);
  const body = await req.json();
  const { action, event, caseId, metadata, actionId, sourceText, sourceLang, targetLang, formality, jobId, translatedText, name, description, toolCategory, config } = body;

  switch (action) {
    case "evaluate_triggers": {
      if (!event) return Response.json({ error: "event required" }, { status: 400 });
      const results = await evaluateProactiveTriggers({ orgId, event, caseId, metadata });
      return Response.json(results);
    }
    case "execute_action": {
      if (!actionId) return Response.json({ error: "actionId required" }, { status: 400 });
      const result = await executeProactiveAction(actionId);
      return Response.json(result);
    }
    case "translate": {
      if (!sourceText || !sourceLang || !targetLang) return Response.json({ error: "sourceText, sourceLang, targetLang required" }, { status: 400 });
      const result = await translateText({ orgId, sourceText, sourceLang, targetLang, formality });
      return Response.json(result);
    }
    case "review_translation": {
      if (!jobId || !translatedText) return Response.json({ error: "jobId and translatedText required" }, { status: 400 });
      const result = await reviewTranslation({ jobId, translatedText, reviewedBy: userId });
      return Response.json(result);
    }
    case "create_tool": {
      if (!name || !toolCategory) return Response.json({ error: "name and category required" }, { status: 400 });
      const tool = await createAiTool({ orgId, name, description, category: toolCategory, config });
      return Response.json(tool);
    }
    default:
      return Response.json({ error: "Invalid action" }, { status: 400 });
  }
});
