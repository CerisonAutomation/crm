import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { generatePageDraft, generateWorkflowDraft } from "@/lib/services/ai-composer";
import { DomainError } from "@/lib/domain/states";

/**
 * INTERNAL endpoint — the AI composer behind the self-build agent.
 *
 * Auth: shared-secret header `x-internal-token` (constant-time compared) OR
 * an authenticated staff session with workflow.write. Everything else is
 * rejected. This endpoint is called mid-execution and also serves direct
 * composition.
 */
function tokenMatches(provided: string): boolean {
  const expected = process.env.INTERNAL_AUTOMATION_TOKEN ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const headerToken = r.headers.get("x-internal-token") ?? "";
    if (!tokenMatches(headerToken)) {
      // No valid internal token — allow an authorised staff session instead.
      const ctx = await requireAuth(r).catch(() => null);
      if (!ctx) throw new DomainError("Unauthorised internal call", 401);
      requireCapability(ctx, "workflow.write");
    }

    const body = await readJson<{ mode?: string; brief?: string; hints?: string }>(r);
    const mode = body.mode === "workflow" ? "workflow" : body.mode === "page" ? "page" : null;
    if (!mode) throw new DomainError("mode must be 'page' or 'workflow'", 400);
    const brief = (body.brief ?? "").trim();
    if (!brief) throw new DomainError("brief required", 400);
    // `hints` was accepted and then ignored, so caller guidance silently did
    // nothing. Fold it into what the generator actually sees.
    const hints = (body.hints ?? "").trim();
    const prompt = hints ? `${brief}\n\nAdditional guidance: ${hints}` : brief;

    if (mode === "page") {
      const draft = await generatePageDraft(prompt);
      return jsonOk({ mode, artifact: { title: draft.title, blocks: draft.blocks }, provider: draft.provider });
    }
    const draft = await generateWorkflowDraft(prompt);
    return jsonOk({
      mode,
      artifact: { name: draft.name, description: draft.description, nodes: draft.nodes, edges: draft.edges },
      provider: draft.provider,
    });
  })(req);
}
