import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { startRun } from "@/lib/services/workflow-engine";
import { emitAutomationEvent } from "@/lib/adapters/automation";
import { DomainError } from "@/lib/domain/states";
import { hit } from "@/lib/rate-limit";
import { draftContent, liveContent } from "../../_lib/page-content";
import { pagePreviewToken } from "../../_lib/preview-token";
import { canReadRawSubmissions, redactSubmissionData } from "../../_lib/submission-pii";

// POST /api/pages/[id]/publish | /unpublish | /submit | /rollback

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return handler(async (r) => {
    const page = await db.lanePage.findUnique({ where: { id } });
    if (!page) throw new DomainError("Page not found", 404);

    if (action === "publish" || action === "unpublish") {
      const ctx = await requireAuth(r);
      requireCapability(ctx, "page.write");
      if (page.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      if (action === "publish") {
        // What goes live is the CURRENT draft revision (or the legacy columns).
        // A page with no form block MAY be published — an editorial page is a
        // page; the reader falls back to the general enquiry form. `hasForm` is
        // returned so the editor can state that absence explicitly.
        const draft = await draftContent(page);
        const blocks = JSON.parse(draft.blocks) as Block[];
        const hasForm = blocks.some((b) => b.type === "form");
        // Promote the pointer: the published revision's own sequence number
        // becomes the page version. A legacy page (no revision) keeps the old
        // counter behaviour.
        const version = draft.revisionId ? draft.version : page.version + (page.status === "PUBLISHED" ? 1 : 0);
        const updated = await db.lanePage.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            version,
            publishedRevisionId: draft.revisionId,
          },
        });
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "page.published",
          target: page.slug,
          after: { version: updated.version, revisionId: draft.revisionId, hasForm },
        });
        return jsonOk({ status: updated.status, version: updated.version, hasForm });
      }
      const updated = await db.lanePage.update({ where: { id }, data: { status: "UNPUBLISHED" } });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "page.unpublished", target: page.slug });
      return jsonOk({ status: updated.status });
    }

    // Rollback: a POINTER MOVE back onto an earlier immutable revision. Nothing
    // is rewritten; the page's current (and, if live, published) pointer moves,
    // the legacy cache columns are mirrored so every read path agrees.
    if (action === "rollback") {
      const ctx = await requireAuth(r);
      requireCapability(ctx, "page.write");
      if (page.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      const body = await readJson<{ revisionId?: string }>(r);
      if (!body.revisionId) throw new DomainError("revisionId is required", 400);
      const rev = await db.pageRevision.findUnique({ where: { id: body.revisionId } });
      if (!rev || rev.pageId !== id) throw new DomainError("Revision not found", 404);
      const published = page.status === "PUBLISHED";
      const updated = await db.lanePage.update({
        where: { id },
        data: {
          blocks: rev.blocks,
          bindings: rev.bindings,
          title: rev.title,
          currentRevisionId: rev.id,
          // A live page rolls back in public too; a draft page only moves the
          // working pointer (its next publish will promote it).
          ...(published ? { publishedRevisionId: rev.id, version: rev.version } : {}),
        },
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "page.rolled_back",
        target: page.slug,
        after: { revisionId: rev.id, version: rev.version, published },
      });
      return jsonOk({ ok: true, revisionId: rev.id, version: updated.version, status: updated.status, published });
    }

    if (action === "submit") {
      // public-ish: submission may come from an authenticated staff preview OR anonymous visitor (within sandbox single-route app)
      const ctx = await requireAuth(r).catch(() => null);
      if (page.status !== "PUBLISHED") throw new DomainError("Page is not published", 409);

      // Abuse control: per-IP, matching every other public endpoint. The client
      // address is not attacker-chosen the way a cookie is, so it cannot be
      // rotated to bypass the cap, and it keeps one caller from exhausting the
      // budget for everyone else.
      const ip =
        r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        r.headers.get("x-real-ip")?.trim() ||
        "unknown";
      const gate = hit(`page-submit:${ip}`, 5, 600_000);
      if (!gate.allowed) {
        throw new DomainError(`Too many submissions — try again in ${gate.retryAfterSec}s`, 429);
      }

      const body = await readJson<{ data: Record<string, string>; formKey?: string }>(r);
      if (!body.data?.name || !body.data?.email) throw new DomainError("name and email are required", 400);

      // The LIVE binding set is the published revision's, not the draft's.
      const live = await liveContent(page);
      const bindings = JSON.parse(live.bindings) as Array<{ formKey: string; workflowId: string }>;
      const binding = bindings.find((b) => !body.formKey || b.formKey === body.formKey) ?? bindings[0];

      const submission = await db.pageSubmission.create({
        data: { pageId: id, data: JSON.stringify(body.data), status: "RECEIVED" },
      });

      let runId: string | null = null;
      // Why a run did (or did not) start. A stale binding — target unpublished,
      // disabled, deleted or another tenant's — records `runId: null` and still
      // answers 201, so the reason has to land somewhere an operator can read it.
      let dispatch = "no_binding";
      if (binding) {
        // Defence in depth: only ever dispatch a workflow owned by the page's own
        // organisation. Bindings are validated when saved, but a legacy/cross-org
        // row must never be able to start another tenant's workflow here.
        const boundWf = await db.workflow.findUnique({
          where: { id: binding.workflowId },
          select: { orgId: true, status: true, disabled: true },
        });
        if (boundWf && boundWf.orgId === page.orgId && boundWf.status === "PUBLISHED" && !boundWf.disabled) {
          dispatch = "run_failed";
          const run = await startRun({
            workflowId: binding.workflowId,
            pageSubmissionId: submission.id,
            trigger: "page.submitted",
            context: { submissionId: submission.id, name: body.data.name, email: body.data.email, page: page.slug },
          }).catch((e) => {
            console.error("[pages] workflow run failed", e);
            return null;
          });
          runId = run?.id ?? null;
          if (runId) {
            dispatch = "dispatched";
            await db.pageSubmission.update({ where: { id: submission.id }, data: { runId, status: "PROCESSED" } });
          }
        } else {
          dispatch = !boundWf
            ? "binding_target_missing"
            : boundWf.orgId !== page.orgId
              ? "binding_target_cross_org"
              : boundWf.status !== "PUBLISHED"
                ? "binding_target_unpublished"
                : "binding_target_disabled";
        }
      }

      await audit({ orgId: page.orgId, actorLabel: ctx ? `${ctx.name} [${ctx.role}]` : "anonymous", action: "page.submitted", target: page.slug, after: { submissionId: submission.id, runId, dispatch } });
      void emitAutomationEvent(
        "page.submitted",
        { pageId: page.id, page: page.slug, formKey: body.formKey ?? null, submissionId: submission.id, runId, fields: Object.keys(body.data) },
        { correlationId: runId ?? submission.id, actor: ctx ? `${ctx.name} [${ctx.role}]` : "anonymous", orgId: page.orgId, defer: true }
      );
      return jsonOk({ submissionId: submission.id, runId, correlated: Boolean(runId) }, 201);
    }

    throw new DomainError("Unknown page action", 404);
  })(req);
}

// GET /api/pages/[id]/submissions | /revisions | /preview
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "page.read");
    const page = await db.lanePage.findUnique({ where: { id } });
    if (!page) throw new DomainError("Page not found", 404);
    if (page.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

    if (action === "submissions") {
      const rows = await db.pageSubmission.findMany({ where: { pageId: id }, orderBy: { createdAt: "desc" }, take: 50 });
      // Redact the raw PII payload for readers outside the desk (AUDITOR holds
      // page.read but must not see applicants' raw JSON). Shape is preserved so
      // the editor's viewer keeps working with a value-free body.
      const canSeeRaw = canReadRawSubmissions(ctx.role);
      const submissions = canSeeRaw
        ? rows
        : rows.map((s) => ({ ...s, data: redactSubmissionData(s.data), redacted: true }));
      return jsonOk({ submissions, redacted: !canSeeRaw });
    }

    if (action === "revisions") {
      const revisions = await db.pageRevision.findMany({
        where: { pageId: id },
        orderBy: { version: "desc" },
        take: 50,
        select: { id: true, version: true, title: true, note: true, authorLabel: true, createdAt: true },
      });
      return jsonOk({
        revisions,
        currentRevisionId: page.currentRevisionId,
        publishedRevisionId: page.publishedRevisionId,
        version: page.version,
        status: page.status,
      });
    }

    if (action === "preview") {
      // Mint a signed, EXPIRING draft-preview link. Gated on `page.read` (not
      // `page.write`): a holder of page.read can already read this page's draft
      // blocks through the API, so a shareable URL that exposes the same content
      // for one hour is not an escalation. Fails closed when AUTH_SECRET is
      // unconfigured — no preview link can exist on a host that cannot sign one.
      const token = pagePreviewToken(page.slug);
      if (!token) throw new DomainError("Preview links are unavailable — AUTH_SECRET is not configured", 503);
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: "page.preview_link_issued", target: page.slug });
      return jsonOk({ url: `/p/${page.slug}?preview=${token}` });
    }

    throw new DomainError("Not found", 404);
  })(req);
}

type Block = { key: string; type: string; config: Record<string, unknown> };
