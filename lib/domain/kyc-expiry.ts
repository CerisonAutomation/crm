/**
 * KYC expiry & re-validation clock (pure domain, no framework imports).
 *
 * KycCheck rows carry no expiry columns by design (schema-frozen lane):
 * validity is DERIVED from reviewedAt plus a per-check-type re-validation
 * window. Only a PASSED check with a review timestamp can be valid; anything
 * else is NOT_VALID (never shown as expired — it was never in force).
 * A check inside the expiring threshold is EXPIRING; past validUntil it is
 * EXPIRED and the runner routes it back to REVIEW (see kyc-expiry service).
 */

export type KycCheckType =
  | "IDENTITY"
  | "SANCTIONS"
  | "PEP"
  | "ADVERSE_MEDIA"
  | "SOURCE_OF_FUNDS";

export type KycValidity = "VALID" | "EXPIRING" | "EXPIRED" | "NOT_VALID";

/** Re-validation window per check type, days. Policy defaults — tune here. */
export const REVALIDATE_AFTER_DAYS: Record<KycCheckType, number> = {
  IDENTITY: 365,
  SANCTIONS: 90,
  PEP: 180,
  ADVERSE_MEDIA: 90,
  SOURCE_OF_FUNDS: 365,
};

/** Inside this window before validUntil, a check reads EXPIRING. */
export const EXPIRING_WITHIN_MS = 14 * 86400000;

export type ExpiryInput = {
  checkType: string;
  status: string;
  reviewedAt: Date | string | null | undefined;
};

function windowFor(checkType: string): number | null {
  const days = (REVALIDATE_AFTER_DAYS as Record<string, number>)[checkType];
  return typeof days === "number" && days > 0 ? days : null;
}

/** Derived valid-until, or null when the check was never in force. Pure. */
export function validUntil(check: ExpiryInput): Date | null {
  if (check.status !== "PASSED") return null;
  if (!check.reviewedAt) return null;
  const windowMs = windowFor(check.checkType);
  if (windowMs === null) return null;
  const at =
    check.reviewedAt instanceof Date
      ? check.reviewedAt
      : new Date(check.reviewedAt);
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + windowMs * 86400000);
}

/** Validity of one check at a moment. Pure. */
export function kycValidity(
  check: ExpiryInput,
  now: Date | number = new Date()
): KycValidity {
  const until = validUntil(check);
  if (!until) return "NOT_VALID";
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (until.getTime() <= nowMs) return "EXPIRED";
  if (until.getTime() - nowMs <= EXPIRING_WITHIN_MS) return "EXPIRING";
  return "VALID";
}

/** Case posture rollup: the worst validity across the case's checks. Pure. */
export function caseKycPosture(
  checks: readonly ExpiryInput[],
  now: Date | number = new Date()
): KycValidity {
  let worst: KycValidity = "VALID";
  let seen = false;
  for (const c of checks) {
    const v = kycValidity(c, now);
    if (v === "NOT_VALID") continue;
    seen = true;
    if (v === "EXPIRED") return "EXPIRED";
    if (v === "EXPIRING") worst = "EXPIRING";
  }
  return seen ? worst : "NOT_VALID";
}
