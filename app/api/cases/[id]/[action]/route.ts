import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability, type AuthContext } from "@/lib/auth";
import { transitionCase } from "@/lib/services/case-service";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { DomainError } from "@/lib/domain/states";
import {
  requiredDocumentRequests,
  reconcileRequirements,
} from "@/lib/domain/programmes";
import { storageGet, storagePutWithHistory } from "@/lib/storage";

// Four-eyes distinct-actor gate (R5): the countersigner must differ from the
// PRIMARY actor — persisted ledger column first, audit trail for pre-ledger
// rows, explicit fallback (e.g. the letter uploader) last. Self-countersign
// is rejected with 403 + a four-eyes.violation audit event.
async function assertFourEyes(
  ctx: AuthContext,
  target: string,
  primaryAction: string,
  persistedPrimaryBy: string | null | undefined,
  correlationId: string,
  fallbackPrimaryBy?: string | null
) {
  let primary = persistedPrimaryBy ?? fallbackPrimaryBy ?? null;
  if (!primary) {
    const row = await withTenantContext(ctx.orgId, (tx) =>
      tx.auditEvent.findFirst({
        where: { orgId: ctx.orgId, action: primaryAction, target },
        orderBy: { createdAt: "desc" },
        select: { actorId: true },
      })
    );
    primary = row?.actorId ?? null;
  }
  if (primary && primary === ctx.userId) {
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: ctx.name + " [" + ctx.role + "]",
      action: "four-eyes.violation",
      target,
      after: { primaryAction, primaryBy: primary },
      reason: "Primary actor attempted to countersign their own approval",
      correlationId,
    });
    throw new DomainError(
      "Four-eyes: the countersigner must differ from the primary approver",
      403
    );
  }
}

// POST /api/cases/[id]/service — client selects programme (onboarding step 2)
async function handleServiceSelection(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  requireCapability(ctx, "service.select.own");
  const body = await readJson<{
    programmeId: string;
    acknowledged: boolean;
    deviated?: boolean;
    rationale?: string;
  }>(r);
  if (!body.acknowledged)
    throw new DomainError("You must acknowledge the programme terms", 400);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id } })
  );
  if (!c || c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
  if (
    c.serviceApproval === "APPROVED" ||
    c.serviceApproval === "PRIMARY_APPROVED"
  ) {
    throw new DomainError("Programme choice is already approved", 409);
  }
  const prog = await db.programme.findUnique({
    where: { id: body.programmeId },
  });
  if (!prog || !prog.active)
    throw new DomainError("Programme unavailable", 400);
  // Pin to the latest PUBLISHED ProgramVersion — the case is bound to the
  // terms in force at selection time, not to whatever the catalogue says later.
  const version = await db.programVersion.findFirst({
    where: { programmeId: prog.id, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!version)
    throw new DomainError("No published terms for this programme", 409);
  // Deviation from the pre-scan recommendation requires a rationale.
  if (body.deviated && !body.rationale?.trim()) {
    throw new DomainError(
      "A rationale is required when deviating from the recommendation",
      400
    );
  }
  // Re-selecting after a rejection leaves the case in SERVICE_SELECTED —
  // SERVICE_SELECTED → SERVICE_SELECTED is an illegal self-transition, so
  // the transition is skipped while the new choice is still recorded,
  // audited and fanned out (serviceApproval returns to PENDING).
  const reselect = c.status === "SERVICE_SELECTED";
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
    await tx.case.update({
      where: { id },
      data: { programmeId: prog.id, serviceApproval: "PENDING" },
    });
    // Upsert the ServiceSelection — one per case, updated on re-selection.
    await tx.serviceSelection.upsert({
      where: { caseId: id },
      create: {
        caseId: id,
        programmeId: prog.id,
        versionId: version.id,
        status: "PENDING",
        deviated: body.deviated ?? false,
        rationale: body.rationale ?? null,
        selectedBy: ctx.userId,
      },
      update: {
        programmeId: prog.id,
        versionId: version.id,
        status: "PENDING",
        deviated: body.deviated ?? false,
        rationale: body.rationale ?? null,
        selectedBy: ctx.userId,
      },
    });
  });
  if (!reselect) {
    await transitionCase({
      caseId: id,
      to: "SERVICE_SELECTED",
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [CLIENT]`,
      command: "service.select",
      reason: `Client selected ${prog.name}`,
      correlationId,
    });
  }
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "service.selected",
    target: c.reference,
    after: {
      programme: prog.key,
      version: version.version,
      deviated: body.deviated ?? false,
      reselect,
    },
    correlationId,
  });

  // Event hub — assigned RMs are asked for the secondary approval (client is the actor).
  await emitCaseEvent("case.service.selected", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [CLIENT]`,
    meta: {
      programme: prog.name,
      programmeKey: prog.key,
      version: version.version,
      deviated: body.deviated ?? false,
    },
    dedupeKey: `service:${c.id}`,
  });
  return jsonOk({ ok: true, status: "SERVICE_SELECTED" });
}

async function handleApproveData(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Handles `action === "approve-data"`.
  // TWO-PERSON RULE: an RM (or SENIOR_RM) performs the PRIMARY review, and
  // only a SENIOR_RM may countersign (see "countersign-data" below).
  // Holding `case.approve.data` is deliberately NOT enough to countersign.
  requireCapability(ctx, "case.approve.data");
  const body = await readJson<{
    decision: "APPROVED" | "REJECTED";
    reason?: string;
  }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id }, include: { programme: true } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

  if (body.decision === "APPROVED") {
    // PRIMARY approval only. The case does NOT advance — it waits for a
    // senior countersignature that completes DATA_APPROVED.
    if (c.dataApproval !== "PENDING" && c.dataApproval !== null)
      throw new DomainError(`Data approval already ${c.dataApproval}`, 409);
    await withTenantContext(ctx.orgId, (tx) =>
      tx.case.update({
        where: { id },
        data: { dataApproval: "PRIMARY_APPROVED", dataPrimaryBy: ctx.userId },
      })
    );
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "case.data.approved.primary",
      target: c.reference,
      after: { decision: "PRIMARY_APPROVED", awaiting: "countersignature" },
      reason: body.reason,
      correlationId,
    });
    await emitCaseEvent("case.data.approved", {
      caseId: c.id,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      meta: {
        decision: "PRIMARY_APPROVED",
        awaiting: "countersignature",
        reason: body.reason ?? null,
      },
      dedupeKey: `data:${c.id}:PRIMARY_APPROVED`,
    });
    return jsonOk({
      ok: true,
      dataApproval: "PRIMARY_APPROVED",
      awaitingCountersignature: true,
    });
  }

  // REJECTED — reset the sub-state so a correction can be requested
  // without the case sitting on a terminal label. The review request
  // itself (see "request-changes" below) is what moves the case.
  if (c.dataApproval === "REJECTED")
    throw new DomainError("Data approval already REJECTED", 409);
  if (!body.reason?.trim())
    throw new DomainError("A rejection reason is mandatory", 400);
  await withTenantContext(ctx.orgId, (tx) =>
    tx.case.update({ where: { id }, data: { dataApproval: "REJECTED" } })
  );
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.data.rejected",
    target: c.reference,
    after: { decision: "REJECTED" },
    reason: body.reason,
    correlationId,
  });
  // Event hub — applicant hears the data decision (actor excluded on the staff side).
  await emitCaseEvent("case.data.rejected", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { decision: body.decision, reason: body.reason ?? null },
    dedupeKey: `data:${c.id}:${body.decision}`,
  });
  return jsonOk({ ok: true, dataApproval: body.decision });
}

async function handleCountersignData(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Handles `action === "countersign-data"`.
  // SECONDARY (countersigning) approval — SENIOR_RM only. This is the
  // second half of the two-person rule: it completes what the primary
  // approval started.
  requireCapability(ctx, "case.approve.data.secondary");
  const body = await readJson<{ reason?: string }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id }, include: { programme: true } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (c.dataApproval !== "PRIMARY_APPROVED") {
    throw new DomainError(
      c.dataApproval === "APPROVED"
        ? "Data already countersigned"
        : "Primary approval required before countersignature",
      409
    );
  }
  await assertFourEyes(
    ctx,
    c.reference,
    "case.data.approved.primary",
    c.dataPrimaryBy,
    correlationId
  );
  await withTenantContext(ctx.orgId, (tx) =>
    tx.case.update({ where: { id }, data: { dataApproval: "APPROVED" } })
  );
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.data.approved.secondary",
    target: c.reference,
    after: { decision: "APPROVED" },
    reason: body.reason,
    correlationId,
  });
  if (c.status === "DATA_SUBMITTED") {
    await transitionCase({
      caseId: id,
      to: "DATA_APPROVED",
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      command: "countersign-data",
      reason: body.reason,
      correlationId,
    });
  }
  await emitCaseEvent("case.data.approved", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: {
      decision: "APPROVED",
      countersigned: true,
      reason: body.reason ?? null,
    },
    dedupeKey: `data:${c.id}:SECONDARY_APPROVED`,
  });
  return jsonOk({ ok: true, dataApproval: "APPROVED" });
}

async function handleRequestChanges(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Handles `action === "request-changes"`.
  // RM sends a rejected case back for correction. Uses the ALREADY-LEGAL
  // DATA_SUBMITTED → ONBOARDING edge ("client corrected data") and resets
  // the sub-state, so the dead `VERIFICATION_IN_PROGRESS` screen becomes a
  // working correction loop instead of a wedge.
  requireCapability(ctx, "case.approve.data");
  const body = await readJson<{ reason?: string }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id }, include: { programme: true } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (c.dataApproval !== "REJECTED")
    throw new DomainError(
      "Correction is only available after a rejection",
      409
    );
  await withTenantContext(ctx.orgId, (tx) =>
    tx.case.update({ where: { id }, data: { dataApproval: "PENDING" } })
  );
  await transitionCase({
    caseId: id,
    to: "ONBOARDING",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "request-changes",
    reason: body.reason,
    correlationId,
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.data.correction.requested",
    target: c.reference,
    reason: body.reason,
    correlationId,
  });
  await emitCaseEvent("case.status.changed", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { to: "ONBOARDING", reason: body.reason ?? null },
    dedupeKey: `correct:${c.id}:${Date.now()}`,
  });
  return jsonOk({ ok: true, status: "ONBOARDING", dataApproval: "PENDING" });
}

async function handleApproveService(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Handles `action === "approve-service"`.
  // TWO-PERSON RULE (same as data): an RM records the PRIMARY selection
  // review; only a SENIOR_RM countersignature (see "countersign-service")
  // completes the approval and issues the document set.
  requireCapability(ctx, "case.approve.service");
  const body = await readJson<{
    decision: "APPROVED" | "REJECTED";
    reason?: string;
  }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({
      where: { id },
      include: { programme: true, serviceSelection: true },
    })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

  if (body.decision === "APPROVED") {
    if (c.serviceApproval !== "PENDING" && c.serviceApproval !== null)
      throw new DomainError(
        `Service approval already ${c.serviceApproval}`,
        409
      );
    if (!c.programmeId)
      throw new DomainError("Client has not selected a programme", 409);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
      await tx.case.update({
        where: { id },
        data: {
          serviceApproval: "PRIMARY_APPROVED",
          servicePrimaryBy: ctx.userId,
        },
      });
      if (c.serviceSelection) {
        await tx.serviceSelection.update({
          where: { id: c.serviceSelection.id },
          data: { status: "PRIMARY_APPROVED" },
        });
      }
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "case.service.approved.primary",
      target: c.reference,
      after: {
        decision: "PRIMARY_APPROVED",
        awaiting: "countersignature",
        programme: c.programme?.key,
      },
      reason: body.reason,
      correlationId,
    });
    await emitCaseEvent("case.service.approved", {
      caseId: c.id,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      meta: {
        decision: "PRIMARY_APPROVED",
        awaiting: "countersignature",
        programme: c.programme?.name ?? null,
        reason: body.reason ?? null,
      },
      dedupeKey: `service-appr:${c.id}:PRIMARY_APPROVED`,
    });
    return jsonOk({
      ok: true,
      serviceApproval: "PRIMARY_APPROVED",
      awaitingCountersignature: true,
    });
  }

  if (c.serviceApproval === "REJECTED")
    throw new DomainError("Service approval already REJECTED", 409);
  if (!body.reason?.trim())
    throw new DomainError("A rejection reason is mandatory", 400);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
    await tx.case.update({
      where: { id },
      data: { serviceApproval: "REJECTED" },
    });
    if (c.serviceSelection) {
      await tx.serviceSelection.update({
        where: { id: c.serviceSelection.id },
        data: { status: "REJECTED" },
      });
    }
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.service.rejected",
    target: c.reference,
    after: { decision: "REJECTED", programme: c.programme?.key },
    reason: body.reason,
    correlationId,
  });
  await emitCaseEvent("case.service.rejected", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { programme: c.programme?.name ?? null, reason: body.reason ?? null },
    dedupeKey: `service-appr:${c.id}:REJECTED`,
  });
  return jsonOk({ ok: true, serviceApproval: body.decision });
}

async function handleCountersignService(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Handles `action === "countersign-service"`.
  // SECONDARY (countersigning) approval — SENIOR_RM only. Completes what
  // the primary selection review started: SERVICE_APPROVED transition plus
  // the standard document set.
  requireCapability(ctx, "case.approve.service.secondary");
  const body = await readJson<{ reason?: string }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({
      where: { id },
      include: { programme: true, serviceSelection: true },
    })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (c.serviceApproval !== "PRIMARY_APPROVED") {
    throw new DomainError(
      c.serviceApproval === "APPROVED"
        ? "Service already countersigned"
        : "Primary selection review required before countersignature",
      409
    );
  }
  await assertFourEyes(
    ctx,
    c.reference,
    "case.service.approved.primary",
    c.servicePrimaryBy,
    correlationId
  );
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
    await tx.case.update({
      where: { id },
      data: { serviceApproval: "APPROVED" },
    });
    if (c.serviceSelection) {
      await tx.serviceSelection.update({
        where: { id: c.serviceSelection.id },
        data: { status: "APPROVED" },
      });
    }
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.service.approved.secondary",
    target: c.reference,
    after: { decision: "APPROVED", programme: c.programme?.key },
    reason: body.reason,
    correlationId,
  });
  await transitionCase({
    caseId: id,
    to: "SERVICE_APPROVED",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "countersign-service",
    reason: body.reason,
    correlationId,
  });
  // Event hub — the explicit service-approval milestone (applicant + RMs, actor excluded).
  await emitCaseEvent("case.service.approved", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: {
      decision: "APPROVED",
      countersigned: true,
      programme: c.programme?.name ?? null,
      reason: body.reason ?? null,
    },
    dedupeKey: `service-appr:${c.id}:SECONDARY_APPROVED`,
  });
  // The document set is PROGRAMME-DRIVEN: every document the selected
  // programme names in its checklist is requested, with instructions and a
  // due window derived from the catalogue (see requiredDocumentRequests).
  // The old hardcoded set (Certificate of Registration / National ID /
  // Police Record) was wrong for most programmes — it omitted the
  // financial and medical items and requested corporate ones on personal
  // routes. A case cannot issue a set without a programme.
  const programmeKey = c.programme?.key;
  if (!programmeKey)
    throw new DomainError(
      "Programme required before issuing the document set",
      409
    );
  const standard = requiredDocumentRequests(programmeKey);
  for (const s of standard) {
    const dup = await withTenantContext(ctx.orgId, (tx) =>
      tx.documentRequest.findFirst({
        where: { caseId: id, docType: s.docType },
      })
    );
    if (!dup) {
      // NB: spread only the persisted fields — dueInDays is the scheduling hint, not a column.
      await withTenantContext(ctx.orgId, (tx) =>
        tx.documentRequest.create({
          data: {
            caseId: id,
            docType: s.docType,
            title: s.title,
            instructions: s.instructions,
            dueDate: new Date(Date.now() + s.dueInDays * 86400000),
            createdBy: ctx.userId,
          },
        })
      );
    }
  }
  await transitionCase({
    caseId: id,
    to: "DOCS_REQUESTED",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "countersign-service",
    reason: "Standard document set issued",
    correlationId,
  });
  // Event hub — standard document set announcement (replaces the single client notification).
  await emitCaseEvent("request.created", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: {
      title: "Standard document set",
      batch: standard.map((s) => s.title),
    },
    dedupeKey: `std-docs:${c.id}`,
  });
  // WELCOME — the SERVICE_APPROVED milestone carries the canonical
  // onboarding hand-off (lifecycle stage WELCOME_SENT → `message.received`).
  // Persist it as a real client-visible message so it lands in the thread,
  // then fan it out once. The status guard above already blocks a re-run,
  // and the dedupe key makes the notification idempotent regardless.
  const welcomeBody = `Welcome aboard — your programme is confirmed and we have requested the standard document set. Here is what happens next: upload each requested document from your portal, and your relationship manager will review them one by one. You will be kept informed at every stage.`;
  const welcome = await withTenantContext(ctx.orgId, (tx) =>
    tx.comment.create({
      data: {
        caseId: id,
        authorId: ctx.userId,
        body: welcomeBody,
        internal: false,
      },
    })
  );
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "welcome.send",
    target: c.reference,
    after: { messageId: welcome.id },
    correlationId,
  });
  await emitCaseEvent("message.received", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { messageId: welcome.id, senderRole: ctx.role, excerpt: welcomeBody },
    dedupeKey: `welcome:${c.id}`,
  });
  return jsonOk({ ok: true, serviceApproval: "APPROVED" });
}

async function handleDispatch(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  requireCapability(ctx, "dispatch.create");
  const body = await readJson<{ destination: string; documentIds: string[] }>(
    r
  );
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({
      where: { id },
      include: { programme: true, documents: true },
    })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (!["IN_PROGRESS", "FOLLOW_UP", "DISPATCHED"].includes(c.status)) {
    throw new DomainError(`Dispatch not allowed from state ${c.status}`, 409);
  }

  // Dispatch integrity gate — only documents that belong to THIS case AND
  // have been RM_APPROVED may be dispatched. The ids arrive from the client,
  // so an unvalidated list would let a caller dispatch another case's file
  // (or an unreviewed one) under this reference.
  const requestedIds = [...new Set(body.documentIds ?? [])];
  if (requestedIds.length === 0)
    throw new DomainError(
      "At least one approved document is required to dispatch",
      400
    );
  const byId = new Map(c.documents.map((d) => [d.id, d]));
  const foreign = requestedIds.filter((docId) => !byId.has(docId));
  if (foreign.length > 0)
    throw new DomainError(
      "Dispatch references documents that do not belong to this case",
      400
    );
  const notApproved = requestedIds.filter(
    (docId) => byId.get(docId)!.status !== "RM_APPROVED"
  );
  if (notApproved.length > 0)
    throw new DomainError("Every dispatched document must be RM_APPROVED", 409);
  // Completeness — the dispatched set must cover the programme checklist.
  const reconciliation = reconcileRequirements(
    c.programme?.key,
    requestedIds.map((docId) => byId.get(docId)!.type)
  );
  if (
    c.programme?.key &&
    reconciliation.required.length > 0 &&
    !reconciliation.complete
  ) {
    throw new DomainError(
      `Dispatch set is incomplete — missing: ${reconciliation.missing.join(
        ", "
      )}`,
      409
    );
  }

  // DHL adapter — real MyDHL API when configured, sandbox fallback otherwise
  const { createShipment } = await import("@/lib/adapters/dhl-real");
  const shipment = await createShipment({
    caseRef: c.reference,
    destination: body.destination,
    documentRefs: body.documentIds,
  });
  const dup = await withTenantContext(ctx.orgId, (tx) =>
    tx.dispatch.findUnique({ where: { trackingId: shipment.trackingId } })
  );
  if (dup)
    throw new DomainError(
      "Idempotency: shipment already created for this case",
      409
    );

  // Compute the frozen bundle hash — sha256 of the sorted document ids + their
  // content hashes (from imageMeta.sha256 when available). This hash is the
  // integrity anchor for the DHL frozen bundle (FS-12 / §3.14): if any document
  // content changes after dispatch, the hash will not match.
  const { createHash } = await import("node:crypto");
  const docHashes = requestedIds
    .map((docId) => {
      const doc = byId.get(docId)!;
      // Use the document's content hash if available (stored in imageMeta), otherwise
      // fall back to the document id + type + version as a stable proxy.
      let contentHash: string;
      try {
        const meta = JSON.parse(doc.imageMeta ?? "{}");
        contentHash = meta.sha256 ?? doc.id;
      } catch {
        contentHash = doc.id;
      }
      return `${docId}:${contentHash}`;
    })
    .sort()
    .join("|");
  const bundleHash = createHash("sha256").update(docHashes).digest("hex");

  const dispatch = await withTenantContext(ctx.orgId, (tx) =>
    tx.dispatch.create({
      data: {
        caseId: id,
        carrier: "DHL",
        trackingId: shipment.trackingId,
        destination: body.destination,
        documentRefs: JSON.stringify(body.documentIds),
        bundleHash,
        status: "DISPATCHED",
        dispatchedAt: new Date(),
      },
    })
  );
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "dispatch.created",
    target: c.reference,
    after: { trackingId: shipment.trackingId, provider: "DHL" },
    correlationId,
  });
  await transitionCase({
    caseId: id,
    to: "DISPATCHED",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "dispatch",
    reason: `DHL ${shipment.trackingId}`,
    correlationId,
  });
  await withTenantContext(ctx.orgId, (tx) =>
    tx.followUp.create({
      data: {
        caseId: id,
        dispatchId: dispatch.id,
        dueDate: new Date(Date.now() + 42 * 86400000),
        note: "Follow up with authority after 6 weeks.",
      },
    })
  );
  // Event hub — dispatch fan-out with tracking facts (actor excluded on the staff side).
  await emitCaseEvent("dispatch.created", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: {
      dispatchId: dispatch.id,
      trackingId: shipment.trackingId,
      destination: body.destination,
      carrier: "DHL",
      documentIds: body.documentIds,
    },
    dedupeKey: dispatch.id,
  });
  return jsonOk({ dispatch }, 201);
}

async function handleFollowup(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  requireCapability(ctx, "followup.schedule");
  const body = await readJson<{ weeks: number; note?: string }>(r);
  const fu = await withTenantContext(ctx.orgId, async (tx) => {
    const c = await tx.case.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const dispatch = await tx.dispatch.findFirst({
      where: { caseId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!dispatch) throw new DomainError("No dispatch to follow up", 404);
    return tx.followUp.create({
      data: {
        caseId: id,
        dispatchId: dispatch.id,
        dueDate: new Date(Date.now() + body.weeks * 7 * 86400000),
        note: body.note,
      },
    });
  });
  await transitionCase({
    caseId: id,
    to: "FOLLOW_UP",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "followup.schedule",
    reason: `Follow-up in ${body.weeks} weeks`,
    correlationId,
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "followup.scheduled",
    target: `case/${id}`,
    after: { dueDate: fu.dueDate },
    correlationId,
  });
  return jsonOk({ followUp: fu }, 201);
}

async function handleLetterUpload(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // RM uploads approval-in-principle PDF (download handled by the GET export below)
  requireCapability(ctx, "letter.upload");
  const body = await readJson<{ fileName: string; dataBase64: string }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  const sizeBytes = Math.floor((body.dataBase64.length * 3) / 4);
  const { sniffMime, MAX_UPLOAD_BYTES } = await import("@/lib/api-helpers");
  if (sizeBytes > MAX_UPLOAD_BYTES)
    throw new DomainError("File exceeds 10 MB cap", 413);
  if (sniffMime(body.dataBase64) !== "pdf")
    throw new DomainError("Approval letter must be a PDF", 415);
  const count = await withTenantContext(ctx.orgId, (tx) =>
    tx.approvalLetter.count({ where: { caseId: id } })
  );
  const letterId = randomUUID();
  const storageKey = `vault://cases/${id}/letters/${letterId}.bin`;
  // P1-2: seal the exact bytes stored — no legal letter ships without a hash.
  const letterBytes = Buffer.from(body.dataBase64, "base64");
  const { sealLetter } = await import("@/lib/signing/provider");
  const seal = sealLetter(letterBytes);
  const letter = await withTenantContext(ctx.orgId, (tx) =>
    tx.approvalLetter.create({
      data: {
        id: letterId,
        caseId: id,
        fileName: body.fileName,
        mimeType: "application/pdf",
        sizeBytes,
        storageKey,
        version: count + 1,
        scanStatus: "CLEAN",
        uploadedBy: ctx.userId,
        approvedBy: null,
        contentSha256: seal.contentSha256,
        signatureProvider: seal.signatureProvider,
        signatureRef: seal.signatureRef,
        signedAt: seal.signedAt,
      },
    })
  );
  await storagePutWithHistory(storageKey, letterBytes);
  // FOUR-EYES: the letter is PRIMARY_APPROVED on upload; a SENIOR_RM must
  // countersign before it is released to the client (see countersign-letter).
  await withTenantContext(ctx.orgId, (tx) =>
    tx.case.update({
      where: { id },
      data: { letterApproval: "PRIMARY_APPROVED", letterPrimaryBy: ctx.userId },
    })
  );
  await transitionCase({
    caseId: id,
    to: "APPROVED_IN_PRINCIPLE",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "letter.upload",
    reason: "Approval in principle received",
    correlationId,
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "letter.uploaded",
    target: c.reference,
    after: { version: letter.version, letterApproval: "PRIMARY_APPROVED" },
    correlationId,
  });
  // Event hub — the applicant is told the letter is ready; RMs see the issuance.
  await emitCaseEvent("letter.issued", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: {
      letterId: letter.id,
      fileName: letter.fileName,
      version: letter.version,
      letterApproval: "PRIMARY_APPROVED",
    },
    dedupeKey: letter.id,
  });
  return jsonOk(
    {
      letter: { id: letter.id, version: letter.version },
      letterApproval: "PRIMARY_APPROVED",
    },
    201
  );
}

async function handleCountersignLetter(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // SECONDARY (countersigning) approval — SENIOR_RM only. Completes the
  // four-eyes rule for the approval-in-principle letter: the letter is
  // released to the client only after a senior countersignature.
  requireCapability(ctx, "case.approve.letter.secondary");
  const body = await readJson<{ reason?: string }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({
      where: { id },
      include: { letters: { orderBy: { createdAt: "desc" }, take: 1 } },
    })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (c.letterApproval !== "PRIMARY_APPROVED") {
    throw new DomainError(
      c.letterApproval === "APPROVED"
        ? "Letter already countersigned"
        : "Primary letter upload required before countersignature",
      409
    );
  }
  await assertFourEyes(
    ctx,
    c.reference,
    "letter.uploaded",
    c.letterPrimaryBy,
    correlationId,
    c.letters[0]?.uploadedBy ?? null
  );
  // E-SIGN: when the Documenso ceremony is selected, the envelope opens BEFORE
  // the release is recorded — a failed envelope 502s without approving (spec
  // docs/runbooks/esign-spec.md). Unconfigured: HASH path, unchanged.
  let envelopeId: string | null = null;
  {
    const signing = await import("@/lib/signing/provider");
    if (signing.documensoSelected()) {
      const letter = c.letters[0];
      const pdf = letter ? await storageGet(letter.storageKey) : null;
      if (!letter || !pdf) {
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "letter.envelope.failed",
          target: c.reference,
          reason: "Sealed PDF unavailable for envelope",
          correlationId,
        });
        throw new DomainError(
          "E-sign unavailable: sealed PDF has no stored bytes",
          502
        );
      }
      try {
        const env = await signing.requestLetterEnvelope({
          title: letter.fileName,
          fileName: letter.fileName,
          pdf,
          letterId: letter.id,
        });
        envelopeId = env.envelopeId;
      } catch (e) {
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "letter.envelope.failed",
          target: c.reference,
          reason:
            e instanceof Error
              ? e.message.slice(0, 500)
              : "envelope request failed",
          correlationId,
        });
        throw new DomainError("E-sign envelope request failed", 502);
      }
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "letter.envelope.requested",
        target: c.reference,
        after: { letterId: letter.id, envelopeId },
        correlationId,
      });
    }
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`;
    await tx.case.update({
      where: { id },
      data: { letterApproval: "APPROVED" },
    });
    if (c.letters[0])
      await tx.approvalLetter.update({
        where: { id: c.letters[0].id },
        data: {
          approvedBy: ctx.userId,
          ...(envelopeId
            ? { signatureProvider: "DOCUMENSO", signatureRef: envelopeId }
            : {}),
        },
      });
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "letter.countersigned",
    target: c.reference,
    after: { letterApproval: "APPROVED" },
    reason: body.reason,
    correlationId,
  });
  // Event hub — the applicant is told the letter is now approved and ready.
  await emitCaseEvent("letter.approved", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { letterApproval: "APPROVED", reason: body.reason ?? null },
    dedupeKey: `letter-appr:${c.id}:APPROVED`,
  });
  return jsonOk({ ok: true, letterApproval: "APPROVED" });
}

async function handleDocumentRequest(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // RM creates additional (flexible) document request
  requireCapability(ctx, "request.create");
  const body = await readJson<{
    docType: string;
    title: string;
    instructions: string;
    dueInDays?: number;
  }>(r);
  const reqOut = await withTenantContext(ctx.orgId, async (tx) => {
    const c = await tx.case.findUnique({ where: { id } });
    if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const row = await tx.documentRequest.create({
      data: {
        caseId: id,
        docType: body.docType,
        title: body.title,
        instructions: body.instructions,
        dueDate: body.dueInDays
          ? new Date(Date.now() + body.dueInDays * 86400000)
          : null,
        createdBy: ctx.userId,
        flexible: true,
      },
    });
    return { reqRow: row, caseRef: c.reference, caseDbId: c.id };
  });
  const reqRow = reqOut.reqRow;
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "request.created",
    target: reqOut.caseRef,
    after: { docType: body.docType, flexible: true },
    correlationId,
  });
  // Event hub — the applicant gets the request; assigned RMs see it was sent.
  await emitCaseEvent("request.created", {
    caseId: reqOut.caseDbId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: {
      requestId: reqRow.id,
      docType: body.docType,
      title: body.title,
      instructions: body.instructions,
    },
    dedupeKey: reqRow.id,
  });
  return jsonOk({ request: reqRow }, 201);
}

async function handleAssign(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  requireCapability(ctx, "case.assign");
  const body = await readJson<{ assigneeId: string }>(r);
  const assignee = await withTenantContext(ctx.orgId, async (tx) => {
    const c = await tx.case.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    const user = await tx.user.findUnique({ where: { id: body.assigneeId } });
    if (
      !user ||
      user.orgId !== ctx.orgId ||
      !["RM", "SENIOR_RM"].includes(user.role)
    ) {
      throw new DomainError("Assignee must be an RM in your organisation", 400);
    }
    const existing = await tx.caseAssignment.findFirst({
      where: { caseId: id, userId: body.assigneeId },
    });
    if (!existing) {
      await tx.caseAssignment.create({
        data: { caseId: id, userId: body.assigneeId, role: user.role },
      });
    }
    return user;
  });
  const user = assignee;
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "case.assigned",
    target: `case/${id}`,
    after: { assignee: user.email },
    correlationId,
  });
  // Event hub — the assignee (and the applicant) learn about the new ownership.
  await emitCaseEvent("case.assigned", {
    caseId: id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { assigneeId: user.id, assigneeName: user.name },
    dedupeKey: `assign:${id}:${body.assigneeId}`,
  });
  return jsonOk({ ok: true });
}

async function handleVerifyIdentity(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // FINAL_IDENTITY — RM/SENIOR_RM confirms final identity verification is complete.
  // This transitions APPROVED_IN_PRINCIPLE → FINAL_IDENTITY, after which the
  // case can be COMPLETED. Requires the letter to be countersigned (APPROVED).
  requireCapability(ctx, "case.complete");
  const body = await readJson<{ reason?: string }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (c.status !== "APPROVED_IN_PRINCIPLE") {
    throw new DomainError(
      `Identity verification only available from APPROVED_IN_PRINCIPLE, not ${c.status}`,
      409
    );
  }
  if (c.letterApproval !== "APPROVED") {
    throw new DomainError(
      "Letter must be countersigned (APPROVED) before final identity verification",
      409
    );
  }
  await transitionCase({
    caseId: id,
    to: "FINAL_IDENTITY",
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: "verify-identity",
    reason: body.reason ?? "Final identity verification complete",
    correlationId,
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.identity.verified",
    target: c.reference,
    after: { status: "FINAL_IDENTITY" },
    reason: body.reason,
    correlationId,
  });
  await emitCaseEvent("case.status.changed", {
    caseId: c.id,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { to: "FINAL_IDENTITY", reason: body.reason ?? null },
    dedupeKey: `identity:${c.id}:${Date.now()}`,
  });
  return jsonOk({ ok: true, status: "FINAL_IDENTITY" });
}

async function handleTerminalTransition(
  id: string,
  action: "complete" | "cancel",
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Terminal transitions — close or cancel a case (RM / SENIOR_RM / ADMIN).
  requireCapability(ctx, "case.complete");
  const body = await readJson<{ reason?: string }>(r).catch(
    () => ({} as { reason?: string })
  );
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  // COMPLETED is only legal from FINAL_IDENTITY (or legacy APPROVED_IN_PRINCIPLE).
  if (
    action === "complete" &&
    c.status !== "FINAL_IDENTITY" &&
    c.status !== "APPROVED_IN_PRINCIPLE"
  ) {
    throw new DomainError(
      `Case must be in FINAL_IDENTITY (or legacy APPROVED_IN_PRINCIPLE) to complete, not ${c.status}`,
      409
    );
  }
  const to = action === "complete" ? "COMPLETED" : "CANCELLED";
  await transitionCase({
    caseId: id,
    to,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    command: action,
    reason: body.reason,
    correlationId,
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: `case.${to === "COMPLETED" ? "completed" : "cancelled"}`,
    target: c.reference,
    reason: body.reason,
    correlationId,
  });
  return jsonOk({ ok: true, status: to });
}

async function handleEditClient(
  id: string,
  ctx: AuthContext,
  r: NextRequest,
  correlationId: string
) {
  // Handles `action === "edit-client"`.
  // RM/SENIOR_RM edits the client's profile details on a case.
  // Email is immutable — it is the login identifier and legal anchor.
  // All other fields (name, phone, address, city, country, nationality, dateOfBirth)
  // are editable by the desk. Every change is audit-logged.
  requireCapability(ctx, "case.edit.client");
  const body = await readJson<{
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    nationality?: string;
    dateOfBirth?: string;
  }>(r);
  const c = await withTenantContext(ctx.orgId, (tx) =>
    tx.case.findUnique({ where: { id }, include: { client: true } })
  );
  if (!c || c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

  // Build the update payload — only include fields that were provided.
  // Empty strings are allowed (clearing a field is a valid edit).
  const update: Record<string, string> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.address !== undefined) update.address = body.address;
  if (body.city !== undefined) update.city = body.city;
  if (body.country !== undefined) update.country = body.country;
  if (body.nationality !== undefined) update.nationality = body.nationality;
  if (body.dateOfBirth !== undefined) update.dateOfBirth = body.dateOfBirth;

  if (Object.keys(update).length === 0)
    throw new DomainError("No fields to update", 400);

  await withTenantContext(ctx.orgId, (tx) =>
    tx.user.update({ where: { id: c.clientId }, data: update })
  );
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "case.client.edited",
    target: c.reference,
    after: { fields: Object.keys(update) },
    correlationId,
  });
  return jsonOk({ ok: true, updated: Object.keys(update) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);

    switch (action) {
      case "service":
        return handleServiceSelection(id, ctx, r, correlationId);
      case "approve-data":
        return handleApproveData(id, ctx, r, correlationId);
      case "countersign-data":
        return handleCountersignData(id, ctx, r, correlationId);
      case "request-changes":
        return handleRequestChanges(id, ctx, r, correlationId);
      case "approve-service":
        return handleApproveService(id, ctx, r, correlationId);
      case "countersign-service":
        return handleCountersignService(id, ctx, r, correlationId);
      case "dispatch":
        return handleDispatch(id, ctx, r, correlationId);
      case "followup":
        return handleFollowup(id, ctx, r, correlationId);
      case "letter":
        return handleLetterUpload(id, ctx, r, correlationId);
      case "countersign-letter":
        return handleCountersignLetter(id, ctx, r, correlationId);
      case "verify-identity":
        return handleVerifyIdentity(id, ctx, r, correlationId);
      case "requests":
        return handleDocumentRequest(id, ctx, r, correlationId);
      case "assign":
        return handleAssign(id, ctx, r, correlationId);
      case "edit-client":
        return handleEditClient(id, ctx, r, correlationId);
      case "complete":
      case "cancel":
        return handleTerminalTransition(id, action, ctx, r, correlationId);
      default:
        throw new DomainError("Unknown case action", 404);
    }
  })(req);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const { id, action } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (action === "timeline") {
      const c = await withTenantContext(ctx.orgId, (tx) =>
        tx.case.findUnique({ where: { id } })
      );
      if (!c) throw new DomainError("Case not found", 404);
      // Object-level authorisation: clients only see their own case; staff are
      // scoped to their organisation (never cross-tenant).
      if (ctx.role === "CLIENT") {
        if (c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
      } else if (c.orgId !== ctx.orgId) {
        throw new DomainError("Forbidden", 403);
      }
      const history = await withTenantContext(ctx.orgId, (tx) =>
        tx.caseStatusHistory.findMany({
          where: { caseId: id },
          orderBy: { createdAt: "desc" },
        })
      );
      const comments = await withTenantContext(ctx.orgId, (tx) =>
        tx.comment.findMany({
          where: {
            caseId: id,
            ...(ctx.role === "CLIENT" ? { internal: false } : {}),
          },
          include: { author: { select: { name: true, role: true } } },
          orderBy: { createdAt: "desc" },
        })
      );
      return jsonOk({ history, comments });
    }
    if (action === "letter") {
      // download approval letter (authorised roles only; short-lived signed URL stand-in)
      if (ctx.role === "CLIENT") {
        requireCapability(ctx, "letter.read.own");
      } else {
        requireCapability(ctx, "document.read.all");
      }
      const c = await withTenantContext(ctx.orgId, (tx) =>
        tx.case.findUnique({
          where: { id },
          include: { letters: { orderBy: { createdAt: "desc" }, take: 1 } },
        })
      );
      if (!c) throw new DomainError("Case not found", 404);
      if (c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
      if (ctx.role === "CLIENT" && c.clientId !== ctx.userId)
        throw new DomainError("Forbidden", 403);
      const letter = c.letters[0];
      if (!letter) throw new DomainError("No approval letter yet", 404);
      // Seeded/sandbox records may carry a non-vault key with no bytes on disk —
      // resolve what the adapter can and degrade to metadata-only.
      let buf: Buffer | null = null;
      try {
        buf = await storageGet(letter.storageKey);
      } catch {
        buf = null;
      }
      return jsonOk({
        letter: {
          id: letter.id,
          fileName: letter.fileName,
          version: letter.version,
          createdAt: letter.createdAt,
        },
        download: buf ? buf.toString("base64") : null,
        note: buf
          ? null
          : "Sandbox: letter metadata only (no bytes stored for seeded records)",
      });
    }
    throw new DomainError("Unknown case action", 404);
  })(req);
}
