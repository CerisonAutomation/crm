import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { validateGraph, type WfEdge, type WfNode } from "@/lib/services/workflow-engine";
import { TEMPLATE_GRAPHS, templateGallery } from "@/lib/services/workflow-templates";
import { DomainError } from "@/lib/domain/states";

// GET /api/workflows — list with versions; ?templates=1 for template gallery
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");
    const wfs = await db.workflow.findMany({
      where: { orgId: ctx.orgId },
      include: {
        versions: { orderBy: { version: "desc" } },
        owner: { select: { name: true } },
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    const templates = templateGallery();
    return jsonOk({
      workflows: wfs.map((w) => ({
        id: w.id, name: w.name, description: w.description, status: w.status,
        currentVersion: w.currentVersion, disabled: w.disabled,
        owner: w.owner.name, runs: w._count.runs, updatedAt: w.updatedAt,
        versions: w.versions.map((v) => ({ version: v.version, changelog: v.changelog, publishedAt: v.publishedAt, nodes: JSON.parse(v.nodes), edges: JSON.parse(v.edges) })),
      })),
      templates,
    });
  })(req);
}

// POST /api/workflows — create draft | {action:"test-node"} | {action:"validate"}
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action?: string;
      name?: string; description?: string; templateKey?: string;
      pieceKey?: string; sampleInput?: Record<string, unknown>;
      nodes?: WfNode[]; edges?: WfEdge[];
    }>(r);

    if (body.action === "test-node") {
      requireCapability(ctx, "workflow.write");
      const { testNode } = await import("@/lib/services/workflow-engine");
      const result = await testNode(String(body.pieceKey), body.sampleInput ?? {});
      return jsonOk(result);
    }

    if (body.action === "validate") {
      requireCapability(ctx, "workflow.read");
      return jsonOk(validateGraph(body.nodes ?? [], body.edges ?? []));
    }

    requireCapability(ctx, "workflow.write");
    if (!body.name?.trim()) throw new DomainError("Workflow name required", 400);

    // Optional template seeding — the draft graph is copied verbatim from the catalog.
    const graph = body.templateKey ? TEMPLATE_GRAPHS[body.templateKey] : undefined;
    if (body.templateKey && !graph) throw new DomainError("Unknown template", 400);

    const wf = await db.workflow.create({
      data: { orgId: ctx.orgId, name: body.name.trim(), description: body.description ?? "", ownerId: ctx.userId },
    });
    if (graph) {
      await db.workflowVersion.create({
        data: {
          workflowId: wf.id, version: 1,
          nodes: JSON.stringify(graph.nodes), edges: JSON.stringify(graph.edges),
          changelog: "Seeded from template",
        },
      });
    }
    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "workflow.created",
      target: wf.name, after: graph ? { seededFrom: body.templateKey, nodes: graph.nodes.length } : { seededFrom: null },
    });
    return jsonOk({ workflow: { id: wf.id, name: wf.name }, seeded: Boolean(graph) }, 201);
  })(req);
}
