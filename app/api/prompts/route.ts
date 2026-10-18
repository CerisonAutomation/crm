import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createPromptVersion, getPromptVersions } from "@/lib/services/prompt-version";
import { validationFailed } from "@/lib/api-errors";

// GET /api/prompts?key=&status= — ADMIN-only prompt registry.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const q = new URL(r.url).searchParams;
    const prompts = await getPromptVersions(ctx.orgId, {
      key: q.get("key") || undefined,
      status: q.get("status") || undefined,
    });
    return jsonOk({ prompts });
  })(req);
}

// POST /api/prompts
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      key?: string;
      version?: number;
      prompt?: string;
      model?: string;
    }>(r);
    if (!body?.key) throw validationFailed("key is required");
    if (!body?.prompt) throw validationFailed("prompt is required");
    const promptVersion = await createPromptVersion({
      orgId: ctx.orgId,
      key: body.key,
      version: body.version,
      prompt: body.prompt,
      model: body.model,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "prompt.created",
      target: promptVersion.id,
      after: { key: promptVersion.key, version: promptVersion.version },
      correlationId,
    });
    return jsonOk({ prompt: promptVersion }, 201);
  })(req);
}
