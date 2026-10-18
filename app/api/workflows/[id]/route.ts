import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { validateGraph, type WfEdge, type WfNode } from "@/lib/services/workflow-engine";
import { DomainError } from "@/lib/domain/states";

// GET /api/workflows/[id] — full detail (versions, nodes, edges, recent runs)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");
    const wf = await db.workflow.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: "desc" } },
        owner: { select: { name: true } },
        runs: { orderBy: { createdAt: "desc" }, take: 10, include: { nodeRuns: { orderBy: { startedAt: "asc" } } } },
      },
    });
    if (!wf) throw new DomainError("Workflow not found", 404);
    if (wf.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    return jsonOk({
      workflow: {
        ...wf,
        versions: wf.versions.map((v) => ({
          version: v.version, changelog: v.changelog, publishedAt: v.publishedAt,
          nodes: JSON.parse(v.nodes), edges: JSON.parse(v.edges), createdAt: v.createdAt,
        })),
      },
    });
  })(req);
}

// PUT /api/workflows/[id] — save draft (draft never mutates published version)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = await readJson<{ nodes: WfNode[]; edges: WfEdge[] }>(r);
    const wf = await db.workflow.findUnique({ where: { id } });
    if (!wf) throw new DomainError("Workflow not found", 404);
    if (wf.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const validation = validateGraph(body.nodes, body.edges);
    const nextVersion = wf.currentVersion + 1; // draft sits above published
    const draft = await db.workflowVersion.upsert({
      where: { workflowId_version: { workflowId: id, version: nextVersion } },
      update: { nodes: JSON.stringify(body.nodes), edges: JSON.stringify(body.edges), publishedAt: null },
      create: { workflowId: id, version: nextVersion, nodes: JSON.stringify(body.nodes), edges: JSON.stringify(body.edges), changelog: "Draft" },
    });
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: "workflow.draft_saved", target: wf.name, after: { draftVersion: draft.version, valid: validation.ok } });
    return jsonOk({ draftVersion: draft.version, validation });
  })(req);
}

// PATCH /api/workflows/[id] — disable / enable
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");
    const body = await readJson<{ disabled: boolean; reason?: string }>(r);
    const wf = await db.workflow.findUnique({ where: { id } });
    if (!wf) throw new DomainError("Workflow not found", 404);
    if (wf.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const updated = await db.workflow.update({ where: { id }, data: { disabled: body.disabled, status: body.disabled ? "DISABLED" : wf.currentVersion ? "PUBLISHED" : "DRAFT" } });
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: body.disabled ? "workflow.disabled" : "workflow.enabled", target: wf.name, reason: body.reason });
    return jsonOk({ workflow: { id: updated.id, status: updated.status, disabled: updated.disabled } });
  })(req);
}
