import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { startRun, startRunsForTrigger } from "@/lib/services/workflow-engine";
import { getIntegration } from "@/lib/integrations";
import { NODE_CATALOG } from "@/lib/nodes/catalog";
import { triggerManifest } from "@/lib/integrations/n8n-graph";
import { n8nTokenFromSources, verifyN8nToken } from "@/lib/integrations/n8n-triggers";

export const dynamic = "force-dynamic";

/**
 * The n8n → platform door — **workflows only**.
 *
 * A self-hosted n8n instance calls this to start work here: either a named
 * published workflow, or every workflow listening for one trigger piece. The
 * automation engine (events, routines, the dispatcher, the queue) is NOT
 * exposed — that stays in `src/lib/automation/*`. This route opens runs the
 * same way the Studio does, and nothing else.
 *
 * Auth is dual, exactly like the MCP endpoint:
 *   • machine: `Authorization: Bearer <n8n connector API key>` (or
 *     `INTERNAL_AUTOMATION_TOKEN` on a headless deployment) — constant-time
 *     compare, resolved per request from the connector config;
 *   • operator: an admin session through the console, gated on `workflow.write`.
 *
 * Fail-closed: with no key configured and no session, both GET and POST answer
 * 401 — a half-configured instance is never an open door.
 */

/** The token a machine caller must present: the env token, or the connector key. */
async function expectedToken(): Promise<string | null> {
  const connector = await getIntegration("n8n");
  return n8nTokenFromSources(process.env.INTERNAL_AUTOMATION_TOKEN, connector.config.apiKey as string | undefined);
}

/** Machine token when presented and valid, otherwise an operator session. */
async function authorize(req: NextRequest): Promise<{ actor: string; orgId: string | null }> {
  const header = req.headers.get("authorization") ?? req.headers.get("x-n8n-token");
  if (header && verifyN8nToken(header, await expectedToken())) {
    return { actor: "n8n", orgId: null };
  }
  const ctx = await requireAuth(req);
  requireCapability(ctx, "workflow.write");
  return { actor: `session:${ctx.role}`, orgId: ctx.orgId };
}

/**
 * GET — the manifest an operator or an n8n workflow author needs: every trigger
 * piece the platform can start a run from, the endpoint, and the body shape.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    await authorize(r);
    return jsonOk({
      ...triggerManifest(),
      pieces: NODE_CATALOG.length,
      body: {
        workflowId: "optional — start THIS published workflow",
        event: "optional — start every workflow listening for this trigger piece",
        context: "optional — variables handed to the run",
        caseId: "optional — bind the run to a case",
        dedupeKey: "optional — replay-safe idempotency key",
      },
      example: { event: "trigger.case.created", context: { caseId: "cli_…" } },
    });
  })(req);
}

/**
 * POST — start a run (or fan out to every listener).
 *
 * `workflowId` wins when both are given: an explicit target is an instruction,
 * a trigger key is a broadcast. A fan-out with no listeners answers 200 with an
 * empty list rather than an error — an n8n workflow that fires before its
 * counterpart is published must not fail, or it would retry forever.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const { actor } = await authorize(r);
    const body = await readJson<{
      workflowId?: string;
      event?: string;
      caseId?: string;
      context?: Record<string, unknown>;
      dedupeKey?: string;
    }>(r);

    if (body.workflowId) {
      const run = await startRun({
        workflowId: body.workflowId,
        caseId: body.caseId,
        trigger: "n8n",
        context: body.context,
        actorLabel: actor,
        dedupeKey: body.dedupeKey,
      });
      return jsonOk({ started: [{ workflowId: body.workflowId, runId: run.id }] });
    }

    if (!body.event?.trim()) {
      throw new DomainError("workflowId or event is required", 400);
    }
    const started = await startRunsForTrigger(body.event.trim(), {
      trigger: "n8n",
      caseId: body.caseId,
      context: body.context,
      actorLabel: actor,
      dedupeKey: body.dedupeKey,
    });
    return jsonOk({ started, count: started.length });
  })(req);
}
