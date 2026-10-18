import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { DomainError } from "@/lib/domain/states";

// GET /api/messages?caseId= — secure thread (client sees own; staff see assigned/org cases)
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const caseId = new URL(r.url).searchParams.get("caseId");
    if (!caseId) throw new DomainError("caseId required", 400);
    const c = await withTenantContext(ctx.orgId, (tx) => tx.case.findUnique({ where: { id: caseId } }));
    if (!c) throw new DomainError("Case not found", 404);
    // Object-level authorisation: a client may only read their own case thread;
    // every staff role (RM/SENIOR_RM/ADMIN/AUDITOR) is scoped to their organisation.
    if (ctx.role === "CLIENT") {
      if (c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    } else if (c.orgId !== ctx.orgId) {
      throw new DomainError("Forbidden", 403);
    }
    const messages = await withTenantContext(ctx.orgId, (tx) =>
      tx.comment.findMany({
      where: { caseId, internal: false },
      include: { author: { select: { name: true, role: true } }, document: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, scanStatus: true } } },
      orderBy: { createdAt: "asc" },
      }),
    );
    return jsonOk({ messages: messages.map(({ document, ...message }) => ({ ...message, attachment: document && document.scanStatus !== "FLAGGED" ? { id: document.id, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes } : null })) });
  })(req);
}

// POST /api/messages — { caseId, body, documentId? }
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ caseId: string; body: string; documentId?: string }>(r);
    if (!body.body?.trim()) throw new DomainError("Message body required", 400);
    const lookup = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findFirst({
        where: { id: body.caseId },
        select: { id: true, reference: true, clientId: true, orgId: true },
      }),
    );
    const c = lookup;
    if (!c) throw new DomainError("Case not found", 404);
    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "comment.create.own");
      if (c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    } else {
      requireCapability(ctx, "comment.create.all");
      if (c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    }
    let attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    const msg = await withTenantContext(ctx.orgId, (tx) =>
      (async () => {
        if (body.documentId) {
          const document = await tx.document.findUnique({ where: { id: body.documentId } });
          if (!document || document.caseId !== c.id || document.scanStatus === "FLAGGED") {
            throw new DomainError("Attachment is not available for this case", 400);
          }
          attachment = { id: document.id, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes };
        }
        return tx.comment.create({
          data: { caseId: c.id, authorId: ctx.userId, body: body.body.trim(), documentId: body.documentId ?? null, internal: false },
        });
      })(),
    );
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "message.sent", target: c.reference, correlationId: undefined });
    // Event hub — the counterpart (client ⇄ RM team) is notified once, with the
    // same copy logic for both directions; the sender is never self-notified.
    await emitCaseEvent("message.received", {
      caseId: c.id,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      meta: { messageId: msg.id, senderRole: ctx.role, excerpt: body.body.trim().slice(0, 140), documentId: body.documentId ?? null },
      dedupeKey: msg.id,
    });
    return jsonOk({ message: { ...msg, author: { name: ctx.name, role: ctx.role }, attachment } }, 201);
  })(req);
}
