import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import {
  exportN8nBundle,
  triggerManifest,
  N8N_IMPORT_NOTES,
  APP_URL_VARIABLE,
  APP_TOKEN_VARIABLE,
} from "@/lib/integrations/n8n-graph";
import { getIntegration } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * GET /api/n8n/export — the workflows-only n8n artefact.
 *
 * `?workflow=<templateKey>` returns one workflow, the bare call returns the
 * whole bundle (every template compiled from `TEMPLATE_GRAPHS`). The response is
 * importable as-is: n8n accepts a single workflow object, or the `workflows`
 * array of the bundle when imported per file.
 *
 * Deliberately NOT here: the automation engine. Events, routines, the dispatcher
 * and the run ledger never leave the platform (src/lib/automation/*); n8n gets
 * the graph, and calls back in through /api/n8n/triggers to start a real run.
 *
 * Reading the graph is `workflow.read` — the same capability that opens the
 * Studio. It exposes no credential: secrets reach n8n through its own env.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");

    const requested = new URL(r.url).searchParams.get("workflow");
    const bundle = exportN8nBundle(requested ? [requested] : undefined);
    const connector = await getIntegration("n8n");

    return jsonOk({
      ...bundle,
      // What an operator needs to close the loop, served with the artefact so
      // the import is self-describing: the connector's own base URL (never its
      // key), the two env vars n8n must define, and the trigger manifest.
      connector: {
        active: connector.active,
        baseUrl: typeof connector.config.baseUrl === "string" ? connector.config.baseUrl : null,
      },
      env: { url: APP_URL_VARIABLE, token: APP_TOKEN_VARIABLE },
      notes: N8N_IMPORT_NOTES,
      triggers: triggerManifest(),
      counts: {
        workflows: bundle.workflows.length,
        nodes: bundle.workflows.reduce((sum, w) => sum + w.nodes.length, 0),
      },
    });
  })(req);
}
