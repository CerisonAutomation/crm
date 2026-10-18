import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { assertDocumentTransition, DomainError } from "@/lib/domain/states";
import { platformDocStatusLabel } from "@/lib/settings/registry";
import { loadPlatformSettings } from "@/lib/settings/store";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { maybeAdvanceAfterDocs } from "@/lib/services/case-service";
import { extractionReview } from "@/lib/domain/extraction";
import { assertHumanGate } from "@/lib/adapters/ocr/types";
import { fieldEncryption } from "@/lib/adapters/field-encryption";
import { shouldEncryptField } from "@/lib/ports/field-encryption";

// POST /api/documents/[id]/confirm — client confirms extracted data (onboarding step 3/4)
// POST /api/documents/[id]/review — RM approves/rejects/requests changes
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const doc = await withTenantContext(ctx.orgId, (tx) =>
      tx.document.findUnique({ where: { id }, include: { case: true } })
    );
    if (!doc) throw new DomainError("Document not found", 404);
    // Document status labels resolve settings-first (canon underneath), so the
    // response label matches the console and the client portal after a rename.
    const platform = await loadPlatformSettings();

    if (action === "confirm") {
      requireCapability(ctx, "document.confirm.own");
      if (doc.case.clientId !== ctx.userId)
        throw new DomainError("Forbidden", 403);
      assertDocumentTransition(doc.status, "CLIENT_CONFIRMED");
      const updated = await withTenantContext(ctx.orgId, (tx) =>
        tx.document.update({
          where: { id },
          data: { status: "CLIENT_CONFIRMED" },
        })
      );
      // OCR quality — a confirmation is only as good as the extracted data behind
      // it. Record which fields a human should still check (low confidence and
      // not client-edited) so the RM review starts knowing where to look.
      // FIELD-ENC: open sealed identity values for review (never written back).
      // An unopenable envelope is contained to its own row (redacted), never a 500.
      const fields = (
        await withTenantContext(ctx.orgId, (tx) =>
          tx.extractedField.findMany({ where: { documentId: id } })
        )
      ).map((f) =>
        f.value && shouldEncryptField(f.fieldKey)
          ? {
              ...f,
              value: fieldEncryption.openOrRedact(doc.case.orgId, f.value),
            }
          : f
      );
      const review = extractionReview(fields);
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [CLIENT]`,
        action: review.needsReview
          ? "document.confirmed.low_confidence"
          : "document.confirmed",
        target: `${doc.case.reference}/${doc.type}`,
        before: { status: doc.status },
        after: {
          status: "CLIENT_CONFIRMED",
          lowConfidence: review.lowConfidence,
          minConfidence: review.minConfidence,
        },
        correlationId,
      });

      // If all case documents are confirmed and case is in ONBOARDING/DATA_SUBMITTED flow — advance
      const docs = await withTenantContext(ctx.orgId, (tx) =>
        tx.document.findMany({ where: { caseId: doc.caseId } })
      );
      if (doc.case.status === "ONBOARDING" && docs.length > 0) {
        const { transitionCase } = await import("@/lib/services/case-service");
        await transitionCase({
          caseId: doc.caseId,
          to: "DATA_SUBMITTED",
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [CLIENT]`,
          command: "document.confirm",
          reason: "Passport data confirmed by client",
          correlationId,
        });
      }
      // Event hub — RM team learns the extracted data is confirmed; the client is the actor here.
      await emitCaseEvent("document.confirmed", {
        caseId: doc.caseId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [CLIENT]`,
        meta: {
          documentId: doc.id,
          docType: doc.type,
          docTitle: doc.title,
          lowConfidenceFields: review.needsReview
            ? review.lowConfidence
            : undefined,
          needsReview: review.needsReview || undefined,
        },
        dedupeKey: `${doc.id}:confirmed`,
      });
      return jsonOk({
        document: {
          id: updated.id,
          status: updated.status,
          label: platformDocStatusLabel(platform, updated.status),
        },
        extraction: review,
      });
    }

    if (action === "review") {
      requireCapability(ctx, "document.review");
      const body = await readJson<{
        decision: "APPROVED" | "REJECTED" | "REQUEST_CHANGES" | "RENEW";
        reason: string;
      }>(r);
      if (doc.case.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      // FS-9 human gate (shared OCR rebuild): reviewer != uploader (403) and a
      // reason is mandatory for every decision except APPROVED (400).
      const gate = assertHumanGate({
        actorId: ctx.userId,
        uploaderId: doc.uploadedBy,
        decision: body.decision,
        reason: body.reason,
      });
      if (!gate.ok) {
        if (gate.status === 403) {
          await audit({
            orgId: ctx.orgId,
            actorId: ctx.userId,
            actorLabel: `${ctx.name} [${ctx.role}]`,
            action: "four-eyes.violation",
            target: `${doc.case.reference}/${doc.type}`,
            after: { attempt: "document.review", uploadedBy: doc.uploadedBy },
            reason: "Reviewer attempted to review their own upload",
            correlationId,
          });
        }
        throw new DomainError(gate.message, gate.status);
      }

      // RENEW — the document is still valid but expiring (or expired) and needs
      // a fresh issuance. Unlike REQUEST_CHANGES (content is wrong), RENEW
      // accepts the content as-is and asks the client to obtain a new copy.
      const target =
        body.decision === "APPROVED"
          ? "RM_APPROVED"
          : body.decision === "REJECTED"
          ? "RM_REJECTED"
          : "CHANGES_REQUESTED";
      // Review intake: a client-confirmed document enters review implicitly —
      // CLIENT_CONFIRMED → IN_REVIEW (legal) → decision (legal) — so the RM
      // decision is one action, still fully inside the state machine.
      const reviewFrom =
        doc.status === "CLIENT_CONFIRMED" ? "IN_REVIEW" : doc.status;
      assertDocumentTransition(reviewFrom, target);
      const updated = await db.$transaction(async (tx) => {
        // Tenant context inside the existing transaction (same connection).
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
        const d = await tx.document.update({
          where: { id },
          data: { status: target },
        });
        await tx.documentReview.create({
          data: {
            documentId: id,
            reviewerId: ctx.userId,
            decision: body.decision,
            reason: body.reason,
          },
        });
        return d;
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "document.reviewed",
        target: `${doc.case.reference}/${doc.type}`,
        before: { status: doc.status },
        after: { decision: body.decision },
        reason: body.reason,
        correlationId,
      });
      // Once a document is approved the case leaves DOCS_REQUESTED for
      // IN_PROGRESS (state-machine legal), so the DHL dispatch step is reachable.
      if (body.decision === "APPROVED") await maybeAdvanceAfterDocs(doc.caseId);
      // Event hub — applicant AND assigned RMs hear the decision (actor excluded).
      await emitCaseEvent(
        body.decision === "APPROVED"
          ? "document.approved"
          : body.decision === "REJECTED"
          ? "document.rejected"
          : body.decision === "RENEW"
          ? "document.renew_requested"
          : "document.changes_requested",
        {
          caseId: doc.caseId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          meta: {
            documentId: doc.id,
            docType: doc.type,
            docTitle: doc.title,
            reason: body.reason,
            decision: body.decision,
          },
          dedupeKey: `${doc.id}:${body.decision}`,
        }
      );
      return jsonOk({
        document: {
          id: updated.id,
          status: updated.status,
          label: platformDocStatusLabel(platform, updated.status),
        },
      });
    }

    if (action === "comment") {
      // Per-document comment (lifecycle action `document.comment`). An RM may
      // attach a note to THIS document — client-visible, or an INTERNAL note the
      // client never sees (the GET route strips internal comments for CLIENT).
      // The owning client may also comment on their own document, but can never
      // mark a note internal — that flag is a staff-only capability.
      const body = await readJson<{ body: string; internal?: boolean }>(r);
      const text = body.body?.trim();
      if (!text) throw new DomainError("A comment body is required", 400);

      const isStaff = ctx.role !== "CLIENT";
      if (isStaff) {
        requireCapability(ctx, "document.review");
        if (doc.case.orgId !== ctx.orgId)
          throw new DomainError("Forbidden", 403);
      } else {
        requireCapability(ctx, "comment.create.own");
        if (doc.case.clientId !== ctx.userId)
          throw new DomainError("Forbidden", 403);
      }
      // Internal notes are staff-only: a client-supplied `internal` is ignored.
      const internal = isStaff ? body.internal === true : false;

      const comment = await withTenantContext(ctx.orgId, (tx) =>
        tx.comment.create({
          data: {
            caseId: doc.caseId,
            documentId: doc.id,
            authorId: ctx.userId,
            body: text,
            internal,
          },
        })
      );
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "document.comment",
        target: `${doc.case.reference}/${doc.type}`,
        after: { documentId: doc.id, internal },
        correlationId,
      });
      // An internal note is staff-only — never fan it out to the applicant.
      if (!internal) {
        await emitCaseEvent("message.received", {
          caseId: doc.caseId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          meta: {
            messageId: comment.id,
            senderRole: ctx.role,
            excerpt: text,
            documentId: doc.id,
            docType: doc.type,
          },
          dedupeKey: `docc:${comment.id}`,
        });
      }
      return jsonOk(
        {
          comment: {
            id: comment.id,
            body: comment.body,
            internal: comment.internal,
            createdAt: comment.createdAt,
            author: { name: ctx.name, role: ctx.role },
          },
        },
        201
      );
    }

    throw new DomainError("Unknown document action", 404);
  })(req);
}
