/**
 * Subject erasure assessment entry point (Art. 17).
 *
 * Thin service over the pure domain checker: enumerates the stores holding
 * one subject's data and evaluates them against the RoPA register. Read-only
 * (no writes, no purges) — the report feeds triage review, never automation.
 */
import { PROCESSING_ACTIVITIES } from "@/lib/compliance/data-map";
import {
  checkErasureEligibility,
  type EligibilityReport,
} from "@/lib/domain/erasure";

/** Stores holding one subject's data (mirrors the DSAR bundle surface). */
export const SUBJECT_MODELS = [
  "User",
  "Case",
  "Document",
  "Notification",
  "Consent",
  "GdprRequest",
] as const;

/** Read-only eligibility report for a subject. */
export function assessSubjectErasure(): EligibilityReport {
  return checkErasureEligibility({
    models: [...SUBJECT_MODELS],
    activities: PROCESSING_ACTIVITIES,
  });
}
