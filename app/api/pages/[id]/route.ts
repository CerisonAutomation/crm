import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { validateGraph } from "@/lib/services/workflow-engine";
import { DomainError } from "@/lib/domain/states";
import { draftContent } from "../_lib/page-content";
import { canReadRawSubmissions, redactSubmissionData } from "../_lib/submission-pii";

type Block = { key: string; type: string; config: Record<string, unknown> };
type Binding = { formKey: string; workflowId: string; nodeKey?: string };

// GET /api/pages/[id] — page detail incl. submissions count; ?withSubmissions=1
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "page.read");
    const page = await db.lanePage.findUnique({
      where: { id },
      include: { owner: { select: { name: true } } },
    });
    if (!page) throw new DomainError("Page not found", 404);
    if (page.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    // Prefer the current revision (the newest draft save); fall back to the
    // legacy columns for a page that has none.
    const content = await draftContent(page);
    const withSubs = new URL(r.url).searchParams.get("withSubmissions");
    // Redact raw submission PII for readers outside the desk (AUDITOR holds
    // page.read but must not see applicants' raw JSON). Same rule as the
    // /submissions endpoint — both read paths go through `_lib/submission-pii`.
    const submissions = withSubs
      ? (await db.pageSubmission.findMany({ where: { pageId: id }, orderBy: { createdAt: "desc" }, take: 50 })).map((s) =>
          canReadRawSubmissions(ctx.role) ? s : { ...s, data: redactSubmissionData(s.data), redacted: true },
        )
      : undefined;
    return jsonOk({
      page: {
        ...page,
        blocks: JSON.parse(content.blocks),
        bindings: JSON.parse(content.bindings),
      },
      submissions,
    });
  })(req);
}

// PUT /api/pages/[id] — save the draft as a NEW IMMUTABLE revision.
//
// The page keeps its identity; the content goes into a fresh `PageRevision` row
// and the page's `currentRevisionId` moves onto it (the legacy `blocks`/`bindings`
// columns are mirrored so every existing read path keeps working). Crucially the
// `publishedRevisionId` is NOT touched: editing a live page produces a pending
// draft revision, and only `publish` promotes it. Bindings are validated against
// live, same-org workflows exactly as before.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "page.write");
    const body = await readJson<{ blocks: Block[]; bindings?: Binding[]; title?: string; note?: string }>(r);
    const page = await db.lanePage.findUnique({ where: { id } });
    if (!page) throw new DomainError("Page not found", 404);
    if (page.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    if (!Array.isArray(body.blocks)) throw new DomainError("blocks must be an array", 400);

    // validate bindings reference live published workflows
    for (const b of body.bindings ?? []) {
      const wf = await db.workflow.findUnique({ where: { id: b.workflowId } });
      if (!wf) throw new DomainError(`Binding references unknown workflow`, 422);
      // Tenant isolation: a page may only bind workflows of its own organisation,
      // otherwise a crafted binding would let a submission run another tenant's
      // workflow (and its side effects) with attacker-controlled context.
      if (wf.orgId !== ctx.orgId) throw new DomainError(`Binding references a workflow outside your organisation`, 422);
      if (wf.status !== "PUBLISHED" || wf.disabled) throw new DomainError(`Binding workflow "${wf.name}" must be published and enabled`, 422);
    }

    const title = body.title?.trim() || page.title;
    const bindingsJson = JSON.stringify(body.bindings ?? JSON.parse(page.bindings));

    // Next sequence number for this page (per-page, monotonic).
    const last = await db.pageRevision.findFirst({
      where: { pageId: id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const revisionId = randomUUID();
    const version = (last?.version ?? 0) + 1;

    // One atomic batch: append the revision, then move the page pointer + mirror
    // the current-draft cache. `publishedRevisionId` is deliberately omitted.
    await db.$transaction([
      db.pageRevision.create({
        data: {
          id: revisionId,
          pageId: id,
          version,
          title,
          blocks: JSON.stringify(body.blocks),
          bindings: bindingsJson,
          note: body.note?.trim() || "draft saved",
          authorId: ctx.userId,
          authorLabel: `${ctx.name} [${ctx.role}]`,
        },
      }),
      db.lanePage.update({
        where: { id },
        data: {
          title,
          blocks: JSON.stringify(body.blocks),
          bindings: bindingsJson,
          currentRevisionId: revisionId,
        },
      }),
    ]);

    await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: "page.draft_saved", target: page.slug, after: { revisionId, version } });
    return jsonOk({ ok: true, version, revisionId, published: page.status === "PUBLISHED" });
  })(req);
}
