import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { emitAutomationEvent } from "@/lib/adapters/automation";
import { generateWorkflowDraft } from "@/lib/services/ai-composer";
import { validateGraph, type WfEdge, type WfNode } from "@/lib/services/workflow-engine";
import { DomainError } from "@/lib/domain/states";

/**
 * POST /api/selfbuild/workflow — compose a workflow graph from a goal
 * description. The graph is composed in-process by the AI composer. Result: a
 * DRAFT workflow (v1) that opens in the Studio canvas for human refinement.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = await readJson<{ goal?: string; name?: string }>(r);
    const goal = (body.goal ?? "").trim();
    if (!goal) throw new DomainError("Goal required", 400);
    if (goal.length > 2000) throw new DomainError("Goal too long (2000 chars max)", 400);

    const correlationId = `sbw-${Date.now().toString(36)}`;
    const via = "direct";
    const draft = await generateWorkflowDraft(goal);
    const name = draft.name;
    const description = draft.description;
    const nodes: WfNode[] = draft.nodes;
    const edges: WfEdge[] = draft.edges;
    const provider = draft.provider;

    // Engine validation before persisting — an invalid graph never reaches the canvas.
    const validation = validateGraph(nodes, edges);
    if (!validation.ok) throw new DomainError(`Composed graph invalid: ${validation.errors.join("; ")}`, 422);

    const wfName = (body.name?.trim() || name || "AI Composed Workflow").slice(0, 100);
    const workflow = await db.workflow.create({
      data: {
        orgId: ctx.orgId,
        name: wfName,
        description: description.slice(0, 240),
        ownerId: ctx.userId,
      },
    });
    await db.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
        changelog: `AI composed (${via}/${provider}) from goal: ${goal.slice(0, 120)}`,
      },
    });

    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "selfbuild.workflow.created", target: wfName,
      after: { via, provider, nodes: nodes.length }, correlationId,
    });
    // Fire-and-forget completion event — durable queue (see selfbuild/page route).
    void emitAutomationEvent("selfbuild.completed", { mode: "workflow", via, provider, workflowId: workflow.id }, { correlationId, actor: `${ctx.name} [${ctx.role}]`, orgId: ctx.orgId, defer: true });

    return jsonOk({ workflow: { id: workflow.id, name: wfName }, via, provider, validation }, 201);
  })(req);
}
