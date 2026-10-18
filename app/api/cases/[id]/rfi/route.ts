import { NextRequest } from "next/server";
import { db, withTenantContext, type TenantTx } from "@/lib/db";
import { handler, jsonOk, readJson, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";
import { openRfiThread, rfiService } from "@/lib/adapters/prisma-rfi-store";
import { toThread } from "@/lib/services/rfi";

export const dynamic = "force-dynamic";

/**
 * RFI threads on a case (ADR-005).
 *
 * GET  /api/cases/[id]/rfi — list threads with turns, newest thread first.
 *        Staff/auditor read every thread (rfi.read.all); the client reads
 *        their own case threads (rfi.read.own).
 * POST /api/cases/[id]/rfi — staff opens a thread (rfi.manage): the opening
 *        QUESTION arms the SLA clock. Idempotent per dedupeKey (C9).
 *
 * Every turn and transition is audit-logged inside the use case — a 200 with
 * no audit row is a defect, not a shortcut.
 */

type OpenBody = {
  subject?: unknown;
  body?: unknown;
  documentRequestId?: unknown;
  slaHours?: unknown;
  ownerId?: unknown;
  dedupeKey?: unknown;
};

async function loadCase(id: string, tx: TenantTx | typeof db = db) {
  const kase = await tx.case.findUnique({
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    const rows = await deps.store.threadsForCase(kase.orgId, kase.id);
    return jsonOk({ threads: rows.map(toThread) });
  })(req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "rfi.manage");
    const kase = await withTenantContext(ctx.orgId, (tx) => loadCase(id, tx));
    if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const body = await readJson<OpenBody>(r as Request as NextRequest);

    const dedupeKey =
      typeof body.dedupeKey === "string"
        ? body.dedupeKey.trim().slice(0, 120)
        : "";
    if (dedupeKey) {
      const prior = await db.idempotencyKey
        .findUnique({ where: { key: "rfi-open:" + dedupeKey } })
        .catch(() => null);
      if (prior && prior.resultRef) {
        try {
          const parsed = JSON.parse(prior.resultRef) as { thread?: unknown };
          if (parsed.thread)
            return jsonOk({ thread: parsed.thread, deduped: true });
        } catch {
          // corrupt receipt — fall through and open once more
        }
      }
    }

    if (
      typeof body.documentRequestId === "string" &&
      body.documentRequestId.trim() !== ""
    ) {
      const linked = await db.documentRequest.findFirst({
        where: { id: body.documentRequestId.trim(), caseId: kase.id },
        select: { id: true },
      });
      if (!linked)
        throw new DomainError(
          "documentRequestId does not belong to this case",
          400
        );
    }

    const deps = rfiService();
    const thread = await openRfiThread(
      deps,
      {
        id: kase.id,
        orgId: kase.orgId,
        clientId: kase.clientId,
        status: kase.status,
        rmAssignedId: kase.rmAssignedId,
      },
      { id: ctx.userId, role: ctx.role, label: actorLabel(ctx) },
      {
        subject: body.subject,
        body: body.body,
        documentRequestId: body.documentRequestId,
        slaHours: body.slaHours,
        ownerId: body.ownerId,
      },
      correlationId
    );

    await notifyUser({
      userId: kase.clientId,
      category: "CASE",
      title: "New question on your case " + kase.reference,
      body: thread.subject,
      caseId: kase.id,
    }).catch(() => undefined);

    if (dedupeKey) {
      await db.idempotencyKey
        .create({
          data: {
            key: "rfi-open:" + dedupeKey,
            scope: "http",
            resultRef: JSON.stringify({ thread }),
          },
        })
        .catch(() => undefined);
    }
    return jsonOk({ thread }, 201);
  })(req);
}
