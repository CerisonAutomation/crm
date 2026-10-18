import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deletePromptVersion, getPromptVersion, updatePromptVersion } from "@/lib/services/prompt-version";
import { notFound } from "@/lib/api-errors";

async function ownedPrompt(id: string, orgId: string) {
  const prompt = await getPromptVersion(id);
  if (!prompt || prompt.orgId !== orgId) throw notFound("Prompt not found");
  return prompt;
}

// GET /api/prompts/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const prompt = await ownedPrompt(id, ctx.orgId);
    return jsonOk({ prompt });
  })(req);
}

// PATCH /api/prompts/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedPrompt(id, ctx.orgId);
    const body = await readJson<{
      prompt?: string;
      model?: string;
      status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    }>(r);
    const prompt = await updatePromptVersion(id, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "prompt.updated",
      target: prompt.id,
      after: body,
      correlationId,
    });
    return jsonOk({ prompt });
  })(req);
}

// DELETE /api/prompts/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedPrompt(id, ctx.orgId);
    await deletePromptVersion(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "prompt.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
