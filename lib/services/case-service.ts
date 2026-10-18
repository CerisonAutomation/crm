/**
 * Case service — the only module allowed to change Case.status.
 * Enforces the transition table, appends status history, and hands the
 * "case.status.changed" event to the event hub (notifications, workflow
 * fan-out, automation backend) + audit.
 */
import { db } from "@/lib/db";
import { assertCaseTransition, DomainError } from "@/lib/domain/states";
import { canonicalDocumentKey } from "@/lib/domain/lifecycle";
import { reconcileRequirements } from "@/lib/domain/programmes";
import { emitCaseEvent } from "@/lib/services/event-hub";

export async function transitionCase(opts: {
  caseId: string;
  to: string;
  actorId?: string;
  actorLabel?: string;
  reason?: string;
  command: string;
  correlationId?: string;
  /** Event-hub depth of the mutation that caused this transition (reactive-chain cap). */
  hubDepth?: number;
}) {
  const c = await db.case.findUnique({ where: { id: opts.caseId } });
  if (!c) throw new DomainError("Case not found", 404);
  if (c.status === opts.to) return c;
  assertCaseTransition(c.status, opts.to);

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.case.update({ where: { id: c.id }, data: { status: opts.to } });
    await tx.caseStatusHistory.create({
      data: { caseId: c.id, from: c.status, to: opts.to, actorId: opts.actorId, reason: opts.reason, command: opts.command, correlationId: opts.correlationId },
    });
    await tx.auditEvent.create({
      data: {
        orgId: c.orgId, actorId: opts.actorId, actorLabel: opts.actorLabel ?? "system",
        action: "case.status.changed", target: c.reference,
        before: JSON.stringify({ status: c.status }), after: JSON.stringify({ status: opts.to }),
        reason: opts.reason, correlationId: opts.correlationId,
      },
    });
    return next;
  });
  await emitCaseEvent("case.status.changed", {
    caseId: c.id,
    actorId: opts.actorId,
    actorLabel: opts.actorLabel,
    meta: { from: c.status, to: opts.to, command: opts.command, reason: opts.reason ?? null, __hubDepth: opts.hubDepth ?? 0 },
  });
  return updated;
}

export async function nextCaseRef(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CL-${year}-`;
  const last = await db.case.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const seq = (last ? Number(last.reference.slice(prefix.length)) || 0 : 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function maybeAdvanceAfterDocs(caseId: string) {
  const c = await db.case.findUnique({
    where: { id: caseId },
    include: { requests: true, documents: true, programme: true },
  });
  if (!c) return;
  if (c.status !== "DOCS_REQUESTED") return;

  const approvedKeys = new Set(
    c.documents.filter((d) => d.status === "RM_APPROVED").map((d) => canonicalDocumentKey(d.type))
  );
  const requestsSatisfied = c.requests.every((r) => approvedKeys.has(canonicalDocumentKey(r.docType)));
  const reconciliation = reconcileRequirements(c.programme?.key, [...approvedKeys]);
  const programmeSatisfied = !c.programme?.key || reconciliation.required.length === 0 || reconciliation.complete;

  if (!requestsSatisfied || !programmeSatisfied) return;

  await transitionCase({
    caseId,
    to: "IN_PROGRESS",
    command: "documents.complete",
    actorLabel: "system:document-service",
    reason: "Document bundle complete — every requested document approved",
  });
}
