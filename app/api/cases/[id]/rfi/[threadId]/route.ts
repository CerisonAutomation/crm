import { NextRequest } from "next/server";
import { db, withTenantContext, type TenantTx } from "@/lib/db";
import { handler, jsonOk, readJson, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";
import {
  appendRfiTurn,
  closeRfiThread,
  escalateRfiThread,
  rfiService,
} from "@/lib/adapters/prisma-rfi-store";
import { toThread } from "@/lib/services/rfi";

export const dynamic = "force-dynamic";

/**
 * One RFI thread (ADR-005).
 *
 * GET   /api/cases/[id]/rfi/[threadId] — read one thread with turns.
 * POST  /api/cases/[id]/rfi/[threadId] — append a turn { kind: QUESTION |
 *         ANSWER | NOTE, body }. Staff (rfi.manage) ask/note/follow-up; the
 *         case owner answers (rfi.answer.own) — kind rules enforced in-domain.
 * PATCH /api/cases/[id]/rfi/[threadId] — { action: "close" | "escalate" }.
 *         Staff only. Closing ends the chase; escalating routes it to the
 *         RM queue with a SYSTEM turn. Both audit-logged.
 */

type TurnBody = { kind?: unknown; body?: unknown };
type PatchBody = { action?: unknown };

async function loadCase(id: string, tx: TenantTx | typeof db = db) {
  const kase = await db.case.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      orgId: true,
      status: true,
      rmAssignedId: true,
      reference: true,
    },
  });
  if (!kase) throw new DomainError("Case not found", 404);
  return kase;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  const { id, threadId } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const kase = await withTenantContext(ctx.orgId, (tx) => loadCase(id, tx));
    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "rfi.read.own");
      if (kase.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    } else {
      requireCapability(ctx, "rfi.read.all");
      if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    }
    const deps = rfiService();
    const row = await deps.store.threadById(kase.orgId, threadId);
    if (!row || row.caseId !== kase.id)
      throw new DomainError("RFI thread not found", 404);
    return jsonOk({ thread: toThread(row) });
  })(req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  const { id, threadId } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const kase = await withTenantContext(ctx.orgId, (tx) => loadCase(id, tx));
    const isOwner = kase.clientId === ctx.userId;
    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "rfi.answer.own");
      if (!isOwner) throw new DomainError("Forbidden", 403);
    } else {
      requireCapability(ctx, "rfi.manage");
      if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    }
    const body = await readJson<TurnBody>(r as Request as NextRequest);
    const deps = rfiService();
    const thread = await appendRfiTurn(
      deps,
      {
        id: kase.id,
        orgId: kase.orgId,
        clientId: kase.clientId,
        status: kase.status,
        rmAssignedId: kase.rmAssignedId,
      },
      { id: ctx.userId, role: ctx.role, label: actorLabel(ctx) },
      threadId,
      { kind: body.kind, body: body.body },
      correlationId
    );

    const kind = typeof body.kind === "string" ? body.kind : "";
    if (kind === "ANSWER") {
      const staffIds = new Set<string>();
      if (thread.ownerId) staffIds.add(thread.ownerId);
      const assignments = await db.caseAssignment
        .findMany({ where: { caseId: kase.id }, select: { userId: true } })
        .catch(() => []);
      for (const a of assignments) staffIds.add(a.userId);
      staffIds.delete(ctx.userId);
      for (const staffId of staffIds) {
        await notifyUser({
          userId: staffId,
          category: "CASE",
          title: "Client answered on case " + kase.reference,
          body: thread.subject,
          caseId: kase.id,
        }).catch(() => undefined);
      }
    } else if (kind === "QUESTION" && ctx.role !== "CLIENT") {
      await notifyUser({
        userId: kase.clientId,
        category: "CASE",
        title: "Follow-up question on your case " + kase.reference,
        body: thread.subject,
        caseId: kase.id,
      }).catch(() => undefined);
    }
    return jsonOk({ thread });
  })(req);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  const { id, threadId } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "rfi.manage");
    const kase = await withTenantContext(ctx.orgId, (tx) => loadCase(id, tx));
    if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const body = await readJson<PatchBody>(r as Request as NextRequest);
    const action = typeof body.action === "string" ? body.action : "";
    const deps = rfiService();
    const kaseCtx = {
      id: kase.id,
      orgId: kase.orgId,
      clientId: kase.clientId,
      status: kase.status,
      rmAssignedId: kase.rmAssignedId,
    };
    const actor = { id: ctx.userId, role: ctx.role, label: actorLabel(ctx) };
    if (action === "close") {
      const thread = await closeRfiThread(
        deps,
        kaseCtx,
        actor,
        threadId,
        correlationId
      );
      return jsonOk({ thread });
    }
    if (action === "escalate") {
      const thread = await escalateRfiThread(
        deps,
        kaseCtx,
        actor,
        threadId,
        correlationId
      );
      return jsonOk({ thread });
    }
    throw new DomainError('action must be one of "close", "escalate"', 400);
  })(req);
}
