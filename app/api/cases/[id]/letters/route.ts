import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { transitionCase } from "@/lib/services/case-service";
import { notifyUser } from "@/lib/services/notify";
import {
  LETTER_TYPES, letterSubjectFor, letterFileName, letterRefOf, loadLetterData,
  parseLetterFileName, type LetterType,
} from "@/lib/documents/letter-data";
import { renderLetter } from "@/lib/documents/templates";
import { loadBusinessSettings } from "@/lib/business/settings";
import { loadBrandSettings } from "@/lib/brand/settings";
import { letterStyleFor } from "@/lib/documents/letterhead";
import { randomUUID } from "node:crypto";
import { storagePutWithHistory } from "@/lib/storage";
import { sealLetter } from "@/lib/signing/provider";

const LETTER_TYPE_SET = new Set<string>(LETTER_TYPES);

function responseType(row: {
  id: string; fileName: string; version: number; sizeBytes: number; createdAt: Date; uploadedBy: string; uploadedByName?: string;
}) {
  const parsed = parseLetterFileName(row.fileName);
  return {
    id: row.id,
    fileName: row.fileName,
    type: parsed?.type ?? null,
    caseRef: parsed?.caseRef ?? null,
    ref: parsed ? letterRefOf(parsed.caseRef, parsed.sequence) : null,
    version: row.version,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    issuedBy: row.uploadedByName ?? "Citizen Lane",
  };
}

/**
 * POST /api/cases/[id]/letters — generate & issue an official letter on the
 * firm letterhead. Real PDF (pdfkit) rendered from live case data, stored in
 * the vault, recorded as an ApprovalLetter + AuditEvent, the client is
 * notified via the notification service and a "letter.issued" OutboxEvent is
 * recorded for downstream consumers.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "letter.upload"); // RM / SENIOR_RM / ADMIN

    const body = await readJson<{ type?: string }>(r);
    if (!body.type || !LETTER_TYPE_SET.has(body.type)) {
      throw new DomainError(`Unknown letter type: ${body.type ?? "(missing)"}`, 400);
    }
    const type = body.type as LetterType;

    const kase = await withTenantContext(ctx.orgId, (tx) => tx.case.findUnique({ where: { id } }));
    if (!kase || kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

    // ── Render the PDF from live case data ──
    const count = await withTenantContext(ctx.orgId, (tx) => tx.approvalLetter.count({ where: { caseId: id } }));
    const sequence = count + 1;
    const letterRef = letterRefOf(kase.reference, sequence);
    const data = await loadLetterData(id);
    const business = await loadBusinessSettings();
    const brand = await loadBrandSettings();
    const style = letterStyleFor(business, brand);
    const rendered = await renderLetter(type, {
      data,
      letterRef,
      sequence,
      date: new Date(),
      issuer: { name: ctx.name, role: ctx.role },
      business,
      style,
    });

    const fileName = letterFileName(kase.reference, sequence, type);

    // ── Record + store (mirrors the document vault mechanism) ──
    const letterId = randomUUID();
    const storageKey = `vault://cases/${id}/letters/${letterId}.pdf`;
    // P1-2: seal the exact bytes stored — no legal letter ships without a hash.
    const seal = sealLetter(rendered.buffer);
    // M3 race backstop: sequence is best-effort count+1, so a concurrent
    // issuance can target the same (caseId, version) — the unique turns the
    // loser into P2002 and the existing row is returned instead of a duplicate.
    // Tenant-scoped issuance: the create runs inside the caller org so the
    // WITH CHECK binds it; the P2002 fallback reads run in fresh transactions
    // (a failed create aborts its own tx and cannot be reused).
    let letter;
    try {
      letter = await withTenantContext(ctx.orgId, (tx) =>
        tx.approvalLetter.create({
          data: {
            id: letterId,
            caseId: id,
            fileName,
            mimeType: "application/pdf",
            sizeBytes: rendered.buffer.length,
            storageKey,
            version: sequence,
            letterRef,
            scanStatus: "CLEAN",
            uploadedBy: ctx.userId,
            approvedBy: null,
            contentSha256: seal.contentSha256,
            signatureProvider: seal.signatureProvider,
            signatureRef: seal.signatureRef,
            signedAt: seal.signedAt,
          },
        }),
      );
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== "P2002") throw err;
      const existing = await withTenantContext(ctx.orgId, (tx) =>
        tx.approvalLetter.findFirst({ where: { caseId: id, version: sequence } }),
      );
      if (!existing) throw err;
      const issuer = existing.uploadedBy
        ? await withTenantContext(ctx.orgId, (tx) =>
            tx.user.findUnique({ where: { id: existing.uploadedBy as string }, select: { name: true } }),
          )
        : null;
      return jsonOk({ letter: responseType({ ...existing, uploadedByName: issuer?.name ?? undefined }), duplicate: true });
    }
    await storagePutWithHistory(storageKey, rendered.buffer);

    // ── State machine: only when the transition is legal for this type ──
    if (type === "APPROVAL_IN_PRINCIPLE" && kase.status === "FOLLOW_UP") {
      await transitionCase({
        caseId: id, to: "APPROVED_IN_PRINCIPLE", actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`, command: "letter.issue",
        reason: `Approval-in-principle letter ${letterRef} issued`, correlationId,
      });
    }
    if (type === "FINAL_APPROVAL" && kase.status === "APPROVED_IN_PRINCIPLE") {
      await transitionCase({
        caseId: id, to: "COMPLETED", actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`, command: "letter.issue",
        reason: `Final approval letter ${letterRef} issued`, correlationId,
      });
    }

    await audit({
      orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "letter.issued", target: kase.reference,
      after: { letterId: letter.id, type, letterRef, fileName, pages: rendered.pages, sizeBytes: rendered.buffer.length },
      correlationId,
    });

    // ── Notify the client (in-app + push + email per their preferences) ──
    await notifyUser({
      userId: kase.clientId,
      title: "Official letter issued",
      body: `${letterSubjectFor(business, type, kase.reference)} — signed PDF available for download in your portal.`,
      category: "CASE",
      caseId: id,
    });

    // ── Outbox event for downstream consumers (direct write; no event-hub import) ──
    await db.outboxEvent.create({
      data: {
        topic: "letter.issued",
        payload: JSON.stringify({
          caseId: id,
          caseRef: kase.reference,
          letterId: letter.id,
          letterRef,
          type,
          fileName,
          sizeBytes: rendered.buffer.length,
          pages: rendered.pages,
          issuedBy: ctx.userId,
          issuedByName: ctx.name,
          clientId: kase.clientId,
        }),
        correlationId,
      },
    });

    return jsonOk(
      { letter: responseType({ ...letter, uploadedByName: ctx.name }) },
      201,
    );
  })(req);
}

/**
 * GET /api/cases/[id]/letters — list issued letters for the case.
 * Clients see their own case only; staff/auditor any case in their org.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "letter.read.own");
    } else {
      requireCapability(ctx, "case.read.all");
    }
    const kase = await db.case.findUnique({ where: { id } });
    if (!kase) throw new DomainError("Case not found", 404);
    if (ctx.role === "CLIENT" && kase.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

    const letters = await db.approvalLetter.findMany({
      where: { caseId: id },
      orderBy: { createdAt: "desc" },
    });

    // Issuer names resolved in one query (ApprovalLetter stores only the id).
    const issuerIds = [...new Set(letters.map((l) => l.uploadedBy))];
    const issuers = await db.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, name: true } });
    const nameById = new Map(issuers.map((u) => [u.id, u.name]));

    return jsonOk({
      letters: letters.map((l) =>
        responseType({ ...l, uploadedByName: nameById.get(l.uploadedBy) ?? "Citizen Lane" }),
      ),
    });
  })(req);
}
