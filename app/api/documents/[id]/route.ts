import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { extractionReview } from "@/lib/domain/extraction";
import { fieldEncryption } from "@/lib/adapters/field-encryption";
import { shouldEncryptField } from "@/lib/ports/field-encryption";

// GET /api/documents/[id] — document detail (client: own case only; RM+: any in org)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const doc = await withTenantContext(ctx.orgId, (tx) =>
      tx.document.findUnique({
        where: { id },
        include: {
          fields: true,
          reviews: {
            include: { reviewer: { select: { name: true, role: true } } },
            orderBy: { createdAt: "desc" },
          },
          ocrJobs: { orderBy: { createdAt: "desc" }, take: 3 },
          comments: {
            include: { author: { select: { name: true, role: true } } },
            orderBy: { createdAt: "asc" },
          },
          case: {
            select: { id: true, reference: true, clientId: true, orgId: true },
          },
        },
      })
    );
    if (!doc) throw new DomainError("Document not found", 404);
    // tenant/object-level authorisation
    if (ctx.role === "CLIENT" && doc.case.clientId !== ctx.userId)
      throw new DomainError("Forbidden", 403);
    if (ctx.role !== "CLIENT" && doc.case.orgId !== ctx.orgId)
      throw new DomainError("Forbidden", 403);
    if (ctx.role === "CLIENT") {
      // clients never see internal RM notes
      doc.comments = doc.comments.filter((c) => !c.internal);
    }
    // OCR quality state — which extracted fields still need a human check. This
    // is computed, never stored, so it always reflects the live field set (a
    // client edit that lifts a field above the threshold clears it here too).
    // FIELD-ENC: open sealed identity values for display (never written back).
    // An unopenable envelope is contained to its own row (redacted), never a 500.
    doc.fields = doc.fields.map((f) =>
      f.value && shouldEncryptField(f.fieldKey)
        ? { ...f, value: fieldEncryption.openOrRedact(doc.case.orgId, f.value) }
        : f
    );
    return jsonOk({ document: doc, extraction: extractionReview(doc.fields) });
  })(req);
}

// PATCH /api/documents/[id] — client corrects extracted fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      fields: Array<{ fieldKey: string; value: string }>;
    }>(r);
    const doc = await withTenantContext(ctx.orgId, (tx) =>
      tx.document.findUnique({ where: { id }, include: { case: true } })
    );
    if (!doc) throw new DomainError("Document not found", 404);
    if (doc.case.clientId !== ctx.userId)
      throw new DomainError("Forbidden", 403);
    if (
      ![
        "OCR_PROCESSED",
        "CLIENT_CONFIRMED",
        "CHANGES_REQUESTED",
        "RM_REJECTED",
      ].includes(doc.status)
    ) {
      throw new DomainError(`Fields not editable in state ${doc.status}`, 409);
    }
    // One tenant transaction for the whole correction batch: atomic instead of
    // sequential partial writes.
    await withTenantContext(ctx.orgId, (tx) =>
      Promise.all(
        body.fields.map((f) => {
          // FIELD-ENC: identity numbers sealed at rest (fail-closed without a key).
          const stored = shouldEncryptField(f.fieldKey)
            ? fieldEncryption.seal(doc.case.orgId, f.fieldKey, f.value)
            : f.value;
          return tx.extractedField.upsert({
            where: {
              documentId_fieldKey: { documentId: id, fieldKey: f.fieldKey },
            },
            update: {
              value: stored,
              edited: true,
              source: "CLIENT_EDIT",
              confidence: 1,
            },
            create: {
              documentId: id,
              fieldKey: f.fieldKey,
              value: stored,
              edited: true,
              source: "CLIENT_EDIT",
              confidence: 1,
            },
          });
        })
      )
    );
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      action: "document.fields.corrected",
      target: doc.id,
      after: { count: body.fields.length },
    });
    return jsonOk({ ok: true });
  })(req);
}
