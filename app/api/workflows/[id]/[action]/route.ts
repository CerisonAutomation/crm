import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { validateGraph, startTestRun, type WfEdge, type WfNode } from "@/lib/services/workflow-engine";
import { ensureHookForWorkflow, hookUrlFor } from "@/lib/services/autopilot";
import { DomainError } from "@/lib/domain/states";

// POST /api/workflows/[id]/publish | /rollback | /duplicate | /test-run | /run
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = await readJson<{ changelog?: string; toVersion?: number; nodes?: WfNode[]; edges?: WfEdge[]; name?: string; context?: Record<string, unknown> }>(r).catch(() => ({}) as { changelog?: string; toVersion?: number; nodes?: WfNode[]; edges?: WfEdge[]; name?: string; context?: Record<string, unknown> });
    const wf = await db.workflow.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!wf) throw new DomainError("Workflow not found", 404);
    if (wf.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

    if (action === "publish") {
      const latest = wf.versions[0];
      if (!latest) throw new DomainError("No draft to publish", 409);
      if (latest.publishedAt) throw new DomainError("Latest version is already published — edit the canvas and save a new draft first", 409);
      const validation = validateGraph(JSON.parse(latest.nodes), JSON.parse(latest.edges));
      if (!validation.ok) throw new DomainError(`Graph invalid: ${validation.errors.join("; ")}`, 422);
      await db.workflowVersion.update({ where: { workflowId_version: { workflowId: id, version: latest.version } }, data: { publishedAt: new Date(), changelog: body.changelog ?? latest.changelog } });
      await db.workflow.update({ where: { id }, data: { status: "PUBLISHED", currentVersion: latest.version, disabled: false } });
      // Autopilot — auto-generate (idempotently) the secured inbound hook URL
      // so every published workflow is immediately reachable from automation.
      const hook = await ensureHookForWorkflow(ctx.orgId, id, { source: "AUTO" });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.published", target: wf.name, after: { version: latest.version, hookCreated: hook.created } });

      // ONE-TIME SECRET REVEAL — reviewed, intentional. `hook.secret` is the
      // inbound hook signing secret and is non-null ONLY when this publish CREATED
      // the endpoint: ensureHookForWorkflow returns `secret: null` for an endpoint
      // that already exists, so a repeat publish cannot re-read the plaintext and
      // there is no read path that re-derives it (the public hook probe, GET
      // /api/workflows/[id], the admin endpoint list — which returns a masked
      // hint — and the MCP tools all omit or mask it). The actor here must hold
      // `workflow.write`, which is ADMIN-only (CAPABILITIES in
      // src/lib/domain/states.ts), and this is the documented moment at which the
      // admin configures the signer. Re-issuing a secret is a separate, audited
      // rotation. Do not add this field to any GET/list response.
      return jsonOk({
        published: latest.version,
        validation,
        hook: { url: hookUrlFor(hook.token), created: hook.created, secret: hook.secret },
      });
    }

    if (action === "rollback") {
      const to = body.toVersion;
      if (!to) throw new DomainError("toVersion required", 400);
      const target = wf.versions.find((v) => v.version === to);
      if (!target) throw new DomainError("Version not found", 404);
      if (!target.publishedAt) throw new DomainError("Can only roll back to a published version", 409);
      await db.workflow.update({ where: { id }, data: { currentVersion: to, status: "PUBLISHED", disabled: false } });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.rolled_back", target: wf.name, before: { version: wf.currentVersion }, after: { version: to } });
      return jsonOk({ currentVersion: to });
    }

    if (action === "duplicate") {
      const copy = await db.workflow.create({
        data: {
          orgId: wf.orgId, name: `${wf.name} (copy)`, description: wf.description, ownerId: ctx.userId,
        },
      });
      const latest = wf.versions[0];
      if (latest) {
        await db.workflowVersion.create({
          data: { workflowId: copy.id, version: 1, nodes: latest.nodes, edges: latest.edges, changelog: `Duplicated from ${wf.name} v${latest.version}` },
        });
      }
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: "workflow.duplicated", target: copy.name, after: { from: wf.name } });
      return jsonOk({ workflow: { id: copy.id, name: copy.name } }, 201);
    }

    if (action === "test-run") {
      const run = await startTestRun(id, `${ctx.name} [${ctx.role}]`);
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.test_run", target: wf.name, after: { runId: run.id } });
      return jsonOk({ runId: run.id }, 201);
    }

    if (action === "run") {
      // Real (non-dry) manual launch — ADMIN console "Run now". Side effects happen.
      if (wf.status !== "PUBLISHED" || !wf.currentVersion) throw new DomainError("Workflow has no published version", 409);
      if (wf.disabled) throw new DomainError("Workflow is disabled", 409);
      const { startRun } = await import("@/lib/services/workflow-engine");
      const run = await startRun({
        workflowId: id,
        trigger: "manual.api",
        context: body.context ?? {},
        actorLabel: `${ctx.name} [${ctx.role}]`,
      });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.run.launched", target: wf.name, after: { runId: run.id, trigger: "manual.api" } });
      return jsonOk({ runId: run.id }, 201);
    }

    throw new DomainError("Unknown workflow action", 404);
  })(req);
}
