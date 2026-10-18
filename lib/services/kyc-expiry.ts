/**
 * KYC re-validation sweep (Annex BILL-adjacent compliance hygiene).
 *
 * PASSED checks whose derived validUntil has passed flip back to REVIEW with
 * kyc.expired (case event + audit); checks inside the expiring window emit
 * kyc.expiring without flipping. Idempotent: flips are conditional updateMany
 * (status still PASSED), events carry stable dedupe keys so a replayed sweep
 * never double-notifies. Windows come from the pure domain clock
 * (@/lib/domain/kyc-expiry) — this module only reads rows and fans out.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { kycValidity } from "@/lib/domain/kyc-expiry";

/** One sweep pass. Failures are contained per check. */
export async function sweepKycExpiry(
  now = new Date()
): Promise<{ expiring: number; expired: number }> {
  let expiring = 0;
  let expired = 0;
  const rows = await db.kycCheck.findMany({
    where: { status: "PASSED", reviewedAt: { not: null } },
    select: {
      id: true,
      orgId: true,
      caseId: true,
      checkType: true,
      status: true,
      reviewedAt: true,
    },
    take: 200,
  });
  for (const check of rows) {
    try {
      const state = kycValidity(
        {
          checkType: check.checkType,
          status: check.status,
          reviewedAt: check.reviewedAt,
        },
        now
      );
      if (state === "VALID" || state === "NOT_VALID") continue;
      if (state === "EXPIRED") {
        const flipped = await db.kycCheck.updateMany({
          where: { id: check.id, status: "PASSED" },
          data: { status: "REVIEW" },
        });
        if (flipped.count === 0) continue; // lost the race — another sweep flipped it
        expired++;
      } else {
        expiring++;
      }
      const topic = state === "EXPIRED" ? "kyc.expired" : "kyc.expiring";
      if (check.caseId) {
        await emitCaseEvent(topic, {
          caseId: check.caseId,
          actorId: "system",
          actorLabel: "system [RUNNER]",
          meta: { checkId: check.id, checkType: check.checkType, state },
          dedupeKey: `kyc-expiry:${check.id}:${state}`,
        });
      }
      await audit({
        orgId: check.orgId,
        actorId: null,
        actorLabel: "system [RUNNER]",
        action: state === "EXPIRED" ? "kyc.expired" : "kyc.expiring",
        target: check.caseId ? `case/${check.caseId}` : `kyc/${check.id}`,
        after: { checkId: check.id, checkType: check.checkType, state },
      });
    } catch (err) {
      console.error("[kyc-expiry] check " + check.id + " failed", err);
    }
  }
  return { expiring, expired };
}

/** Expiry digest for one case's tile: counts by validity. Pure read. */
export async function caseKycDigest(caseId: string, now = new Date()) {
  const rows = await db.kycCheck.findMany({
    where: { caseId },
    select: { checkType: true, status: true, reviewedAt: true },
  });
  const { caseKycPosture } = await import("@/lib/domain/kyc-expiry");
  return { posture: caseKycPosture(rows, now), total: rows.length };
}
