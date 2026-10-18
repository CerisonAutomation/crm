import { NextRequest } from "next/server";
import { db, withTenantContext, type TenantTx } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { emitAutomationEvent } from "@/lib/adapters/automation";
import {
  ensureRequired,
  listScreenings,
  recordScreening,
  screeningPosture,
  requiredChecks,
  SCREENING_RESULTS,
} from "@/lib/services/screening";

/** Resolve a case the caller may screen, tenant- and role-scoped. */
async function scopedCase(
  id: string,
  ctx: { userId: string; role: string; orgId: string },
  tx: TenantTx | typeof db = db
) {
  const kase = await tx.case.findUnique({
    where: { id },
    select: { id: true, reference: true, clientId: true, orgId: true },
  });
  if (!kase) throw new DomainError("Case not found", 404);
  // Object-level authorisation: clients only ever see their own case; staff
  // are scoped to their organisation (never cross-tenant).
  if (ctx.role === "CLIENT") {
    if (kase.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
  } else if (kase.orgId !== ctx.orgId) {
    throw new DomainError("Forbidden", 403);
  }
  return kase;
}

// GET /api/screenings?caseId= — current results + posture for a case.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const caseId = new URL(r.url).searchParams.get("caseId");
    if (!caseId) throw new DomainError("caseId required", 400);
    const kase = await withTenantContext(ctx.orgId, (tx) =>
      scopedCase(caseId, ctx, tx)
    );
    // Clients may VIEW their own posture; only staff with the screening
    // capability may mutate it (see POST).
    await ensureRequired(kase.id);
    const posture = await screeningPosture(kase.id);
    return jsonOk({
      checks: requiredChecks(),
      rows: posture.rows,
      blocked: posture.blocked,
      outstanding: posture.outstanding.map((c) => c.key),
    });
  })(req);
}

// POST /api/screenings — record a check outcome (staff, screening.run).
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    // Recording a screening outcome is a REGULATED WRITE. The read capability
    // is held by the read-only AUDITOR, who must never attest compliance.
    requireCapability(ctx, "screening.run");
    const body = await readJson<{
      caseId?: unknown;
      checkKey?: unknown;
      result?: unknown;
      note?: unknown;
      providerRef?: unknown;
    }>(r);
    if (typeof body.caseId !== "string" || !body.caseId)
      throw new DomainError("caseId required", 400);
    const caseId: string = body.caseId;
    if (typeof body.checkKey !== "string" || !body.checkKey)
      throw new DomainError("checkKey required", 400);
    if (
      typeof body.result !== "string" ||
      !(SCREENING_RESULTS as readonly string[]).includes(body.result)
    ) {
      throw new DomainError(
        "result must be PASS, FAIL, REVIEW or UNKNOWN",
        400
      );
    }
    const kase = await withTenantContext(ctx.orgId, (tx) =>
      scopedCase(caseId, ctx, tx)
    );
    const row = await recordScreening(kase.id, {
      checkKey: body.checkKey,
      result: body.result as (typeof SCREENING_RESULTS)[number],
      note: typeof body.note === "string" ? body.note : undefined,
      providerRef:
        typeof body.providerRef === "string" ? body.providerRef : undefined,
      runById: ctx.userId,
      runByLabel: `${ctx.name} [${ctx.role}]`,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "screening.recorded",
      target: kase.reference,
      after: { checkKey: row.checkKey, result: row.result },
      correlationId,
    });
    // Automation — the screening event the lifecycle model declares, org-scoped
    // so it fans out only in the emitting tenant.
    const posture = await screeningPosture(kase.id);
    const rows = await listScreenings(kase.id);
    void emitAutomationEvent(
      "kyc.screened",
      {
        caseId: kase.id,
        checkKey: row.checkKey,
        result: row.result,
        blocked: posture.blocked,
        outstanding: posture.outstanding.map((c) => c.key),
      },
      {
        caseId: kase.id,
        actor: `${ctx.name} [${ctx.role}]`,
        correlationId,
        orgId: kase.orgId,
        defer: true,
      }
    ).catch(() => undefined);
    return jsonOk({ row, blocked: posture.blocked, rows: rows.length }, 201);
  })(req);
}
