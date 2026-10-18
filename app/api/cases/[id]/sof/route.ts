import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit, redact } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Source-of-funds questionnaire — the client's own declaration.
 *
 * GET  /api/cases/[id]/sof — read the submitted questionnaire (owner or desk).
 * POST /api/cases/[id]/sof — the CLIENT submits it; only the case owner may,
 *                            and only with the declaration of truthfulness.
 *
 * Why a dedicated route rather than a generic case update: the declaration is a
 * regulated artefact. It carries a submission timestamp and the declarant's
 * identity, it is written through an audit record, and it is the input the AML
 * screening depends on. Free-form case edits must never be able to forge one.
 */

const SOURCE_CATEGORIES = [
  "EMPLOYMENT",
  "BUSINESS",
  "INHERITANCE",
  "INVESTMENT",
  "CRYPTO",
  "OTHER",
] as const;
type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

type SofBody = {
  sourceCategory?: unknown;
  description?: unknown;
  estimatedAmountChf?: unknown;
  evidenceLinks?: unknown;
  declaration?: unknown;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const kase = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findUnique({
        where: { id },
        select: { id: true, reference: true, clientId: true, orgId: true, sof: true },
      }),
    );
    if (!kase) throw new DomainError("Case not found", 404);

    const isOwner = kase.clientId === ctx.userId;
    if (!isOwner) {
      if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      requireCapability(ctx, "sof.review");
    }

    return jsonOk({ caseId: kase.id, reference: kase.reference, sof: kase.sof });
  })(req);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "sof.submit.own");

    const kase = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findUnique({
        where: { id },
        select: { id: true, reference: true, clientId: true, orgId: true, status: true, sof: true },
      }),
    );
    if (!kase) throw new DomainError("Case not found", 404);
    if (kase.clientId !== ctx.userId) {
      throw new DomainError("Forbidden — only the case owner submits the questionnaire", 403);
    }
    if (["COMPLETED", "CANCELLED"].includes(kase.status)) {
      throw new DomainError("This case is closed and no longer accepts submissions", 409);
    }

    const body = await readJson<SofBody>(r as Request as NextRequest);

    if (body.declaration !== true) {
      throw new DomainError("The declaration of truthfulness must be accepted", 400);
    }
    const sourceCategory = typeof body.sourceCategory === "string" ? body.sourceCategory : "";
    if (!SOURCE_CATEGORIES.includes(sourceCategory as SourceCategory)) {
      throw new DomainError(
        `sourceCategory must be one of ${SOURCE_CATEGORIES.join(", ")}`,
        400,
      );
    }

    const description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";
    if (description.length < 20) {
      throw new DomainError("Please describe the source of funds in at least 20 characters", 400);
    }

    const amount =
      typeof body.estimatedAmountChf === "number" &&
      Number.isFinite(body.estimatedAmountChf) &&
      body.estimatedAmountChf >= 0 &&
      body.estimatedAmountChf <= 10_000_000_000
        ? Math.floor(body.estimatedAmountChf)
        : null;

    // Evidence links are pointers (file names / storage keys), never inline
    // documents — capped and length-limited so the JSON column stays bounded.
    const evidenceLinks = Array.isArray(body.evidenceLinks)
      ? body.evidenceLinks
          .filter((l): l is string => typeof l === "string")
          .map((l) => l.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 20)
      : [];

    const prior = kase.sof as Record<string, unknown> | null;
    const submission = {
      sourceCategory,
      description,
      estimatedAmountChf: amount,
      evidenceLinks,
      declaration: true,
      submittedAt: new Date().toISOString(),
      submittedBy: ctx.userId,
      submittedByLabel: `${ctx.name} [${ctx.role}]`,
      // A resubmission supersedes but never erases the earlier declaration.
      revision: (typeof prior?.revision === "number" ? prior.revision : 0) + 1,
    };

    await withTenantContext(ctx.orgId, (tx) =>
      tx.case.update({
        where: { id: kase.id },
        data: { sof: submission as unknown as Prisma.InputJsonValue },
      }),
    );

    await audit({
      orgId: kase.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "sof.submit",
      target: kase.reference,
      before: prior ? { revision: prior.revision ?? 0, sourceCategory: prior.sourceCategory ?? null } : undefined,
      after: {
        revision: submission.revision,
        sourceCategory,
        estimatedAmountChf: amount,
        evidenceCount: evidenceLinks.length,
      },
      reason: "Source-of-funds questionnaire submitted by the client",
    });

    return jsonOk({ received: true, caseId: kase.id, sof: redact(submission) }, 201);
  })(req);
}
