import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { getCaseEvents, verifyChain } from "@/lib/services/case-ledger";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

// Prisma JsonValue payloads are usually objects already, but older rows store
// a stringified blob — normalize so the ZIP always holds real JSON, never a
// string that explodes on the reader side. Fallible by design: returns the
// raw string when it is not parseable rather than dropping evidence.
function safeBundleJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value ?? null;
};

// GET /api/cases/[id]/audit-bundle — download the full audit bundle as a ZIP
// containing: events.json (hash-chained ledger), documents.json, decisions.json,
// letters.json, audit-trail.json (AuditEvent), consent.json (client consent record)
// O1: Per-case audit bundle export (docs+events+decisions+letters)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    const formatParam = r.nextUrl.searchParams.get("format") ?? "zip";

    // Authorization: client can export own case; staff need read access.
    // Export gate + every bulk read below resolve inside the caller org.
    // Each read keeps its own short transaction so the parallel fetch stays
    // parallel (no shared-tx fan-out).
    const kase = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findUnique({
        where: { id },
        select: { id: true, clientId: true, orgId: true, reference: true },
      }),
    );
    if (!kase) return jsonOk({ error: "Case not found" }, 404);

    const isOwner = kase.clientId === ctx.userId;
    const isStaff = ctx.orgId === kase.orgId && ["RM", "SENIOR_RM", "ADMIN", "AUDITOR"].includes(ctx.role);
    if (!isOwner && !isStaff) {
      requireCapability(ctx, "case.read.all");
    }

    // Fetch all data in parallel
        const [events, chain, documents, decisions, letters, auditTrail, consent] = await Promise.all([
          getCaseEvents(id),
          verifyChain(id),
          withTenantContext(ctx.orgId, (tx) =>
            tx.document.findMany({
            where: { caseId: id },
            orderBy: { createdAt: "asc" },
            include: {
              ocrJobs: true,
              fields: true,
              reviews: { include: { reviewer: { select: { name: true } } } },
              comments: { include: { author: { select: { name: true, role: true } } } },
              request: true,
            },
            }),
          ),
          withTenantContext(ctx.orgId, (tx) =>
            tx.caseEvent.findMany({
            where: {
              caseId: id,
              topic: { in: ["case.approve.data", "case.approve.service", "case.reject.data", "case.reject.service"] },
            },
            orderBy: { occurredAt: "asc" },
            }),
          ),
          withTenantContext(ctx.orgId, (tx) =>
            tx.approvalLetter.findMany({
            where: { caseId: id },
            orderBy: { createdAt: "asc" },
            }),
          ),
          // Tier-2 gap (audit H-compliance): the bundle omitted the
          // AuditEvent trail + the consent record. Both are governance
          // evidence and belong in the export.
          withTenantContext(ctx.orgId, (tx) =>
            tx.auditEvent.findMany({
            where: {
              orgId: kase.orgId,
              OR: [{ target: kase.reference }, { target: { contains: id } }],
            },
            orderBy: { createdAt: "asc" },
            take: 2000,
            }),
          ),
          withTenantContext(ctx.orgId, (tx) =>
            tx.consent.findMany({
            where: { userId: kase.clientId },
            orderBy: { createdAt: "asc" },
            }),
          ),
        ]);

    // Build the audit bundle
    const bundle = {
      caseId: kase.id,
      reference: kase.reference,
      exportedAt: new Date().toISOString(),
      exportedBy: { id: ctx.userId, label: ctx.name },
      chain: {
        ok: chain.ok,
        eventCount: events.length,
        headHash: events.length > 0 ? events[events.length - 1].hash : null,
        mismatches: chain.mismatches,
      },
      events: events.map((e, idx) => ({
        seq: idx + 1,
        id: e.id,
        topic: e.topic,
        occurredAt: e.occurredAt.toISOString(),
        actor: e.actorLabel,
        correlationId: e.correlationId,
        prevHash: e.prevHash,
        hash: e.hash,
        payload: safeBundleJson(e.payload),
      })),
      documents: documents.map((d) => ({
              id: d.id,
              type: d.type,
              title: d.title,
              fileName: d.fileName,
              status: d.status,
              version: d.version,
              sizeBytes: d.sizeBytes,
              scanStatus: d.scanStatus,
              createdAt: d.createdAt.toISOString(),
              updatedAt: d.updatedAt.toISOString(),
              fields: d.fields.map((f) => ({
                fieldKey: f.fieldKey,
                value: f.value,
                confidence: f.confidence,
                source: f.source,
                edited: f.edited,
              })),
              reviews: d.reviews.map((r) => ({
                id: r.id,
                decision: r.decision,
                reason: r.reason,
                reviewer: r.reviewer.name,
                createdAt: r.createdAt.toISOString(),
              })),
              // Confidentiality: owning clients must never see internal RM
              // notes — presence is kept (id/author/timestamp) but the text
              // is withheld. Staff and auditors see the full note.
              comments: d.comments.map((c) => ({
                id: c.id,
                body: c.internal && !isStaff ? "[internal staff note withheld]" : c.body,
                author: c.author.name,
                authorRole: c.author.role,
                internal: c.internal,
                createdAt: c.createdAt.toISOString(),
              })),
              request: d.request ? {
                id: d.request.id,
                docType: d.request.docType,
                title: d.request.title,
                status: d.request.status,
              } : null,
            })),
      decisions: decisions.map((d) => ({
              id: d.id,
              topic: d.topic,
              occurredAt: d.occurredAt.toISOString(),
              actor: d.actorLabel,
              correlationId: d.correlationId,
              payload: safeBundleJson(d.payload),
            })),
            letters: letters.map((l) => ({
                          id: l.id,
                          fileName: l.fileName,
                          version: l.version,
                          sizeBytes: l.sizeBytes,
                          createdAt: l.createdAt.toISOString(),
                          uploadedBy: l.uploadedBy,
                          approvedBy: l.approvedBy ?? undefined,
                        })),
      auditTrail: auditTrail.map((a) => ({
        id: a.id,
        action: a.action,
        target: a.target,
        actor: a.actorLabel,
        reason: a.reason ?? undefined,
        correlationId: a.correlationId ?? undefined,
        createdAt: a.createdAt.toISOString(),
      })),
      consent: consent.map((c) => ({
        key: c.key,
        version: c.version,
        granted: c.granted,
        createdAt: c.createdAt.toISOString(),
      })),
    };

    if (formatParam === "json") {
      return new Response(JSON.stringify(bundle, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="audit-bundle-${kase.reference}.json"`,
        },
      });
    }

    // Generate ZIP using JSZip (dynamic import to avoid SSR issues)
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    zip.file("events.json", JSON.stringify(bundle.events, null, 2));
    zip.file("chain.json", JSON.stringify(bundle.chain, null, 2));
    zip.file("documents.json", JSON.stringify(bundle.documents, null, 2));
    zip.file("decisions.json", JSON.stringify(bundle.decisions, null, 2));
    zip.file("letters.json", JSON.stringify(bundle.letters, null, 2));
    zip.file("audit-trail.json", JSON.stringify(bundle.auditTrail, null, 2));
    zip.file("consent.json", JSON.stringify(bundle.consent, null, 2));
    zip.file("manifest.json", JSON.stringify({
      caseId: bundle.caseId,
      reference: bundle.reference,
      exportedAt: bundle.exportedAt,
      exportedBy: bundle.exportedBy,
      fileCount: 7,
      generatedBy: "Citizen Lane Audit Bundle Export",
    }, null, 2));

    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

    return new Response(zipBlob, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="audit-bundle-${kase.reference}-${format(new Date(), "yyyyMMdd")}.zip"`,
      },
    });
  })(req);
}