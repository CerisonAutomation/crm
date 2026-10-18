/**
 * Erasure-eligibility checker (Art. 17) — pure domain, no framework imports.
 *
 * Evaluates a set of Prisma models holding one subject's data against the
 * RoPA register (`ProcessingActivity`): a model under a legalHold activity
 * can never be auto-erased (Art. 17(3)(b) statutory duty); a model whose
 * retention expired with no hold is ERASABLE; anything else is RESTRICT
 * (retain the bytes, restrict processing). Unmapped models fail closed to
 * BLOCKED for human review — an unknown store must never be auto-deleted.
 * Consent withdrawal fans out to propagation tasks, never to silent purges.
 */
import type { ProcessingActivity } from "@/lib/compliance/data-map";

export type ErasureVerdict = "ERASABLE" | "BLOCKED" | "RESTRICT";

export type ModelVerdict = {
  model: string;
  activity: string | null;
  verdict: ErasureVerdict;
  basis: string;
  retentionDays: number | null;
};

export type EligibilityReport = {
  eligible: boolean;
  verdicts: ModelVerdict[];
  blockedBy: string[];
  restricted: string[];
};

/** Per-model verdicts for one subject's stores. Pure. */
export function checkErasureEligibility(input: {
  models: readonly string[];
  activities: readonly ProcessingActivity[];
}): EligibilityReport {
  const verdicts: ModelVerdict[] = [];
  for (const model of input.models) {
    const activity = input.activities.find((a) => a.models.includes(model));
    if (!activity) {
      verdicts.push({
        model,
        activity: null,
        verdict: "BLOCKED",
        basis:
          "Unmapped store — no RoPA activity claims this model; human review required, never auto-erased.",
        retentionDays: null,
      });
      continue;
    }
    if (activity.retention.legalHold) {
      verdicts.push({
        model,
        activity: activity.id,
        verdict: "BLOCKED",
        basis: `Statutory retention duty (${activity.retention.basis}) — erasure declined under GDPR Art. 17(3)(b).`,
        retentionDays: activity.retention.days,
      });
      continue;
    }
    if (activity.retention.days === null) {
      verdicts.push({
        model,
        activity: activity.id,
        verdict: "RESTRICT",
        basis:
          "Kept for the running engagement — restrict processing instead of erasing; re-check after closure.",
        retentionDays: null,
      });
      continue;
    }
    verdicts.push({
      model,
      activity: activity.id,
      verdict: "ERASABLE",
      basis: `Retention window lapsed (${activity.retention.days} days, ${activity.retention.basis}); no hold applies.`,
      retentionDays: activity.retention.days,
    });
  }
  const blockedBy = verdicts
    .filter((v) => v.verdict === "BLOCKED")
    .map((v) => v.model);
  const restricted = verdicts
    .filter((v) => v.verdict === "RESTRICT")
    .map((v) => v.model);
  return {
    eligible: blockedBy.length === 0 && restricted.length === 0,
    verdicts,
    blockedBy,
    restricted,
  };
}

export type PropagationTask = {
  action:
    | "SUPPRESS_SENDS"
    | "RESTRICT_PROCESSING"
    | "SCHEDULE_PURGE"
    | "REVIEW";
  target: string;
  reason: string;
};

/**
 * Consent-withdrawal fan-out (Art. 7(3)): withdrawing a key produces
 * reviewable propagation tasks — never a silent purge. Pure.
 */
export function withdrawalPropagation(consentKey: string): PropagationTask[] {
  switch (consentKey) {
    case "marketing":
      return [
        {
          action: "SUPPRESS_SENDS",
          target: "marketing",
          reason: "Withdrawn consent ends marketing sends immediately.",
        },
        {
          action: "SCHEDULE_PURGE",
          target: "marketing-profiles",
          reason:
            "No statutory hold covers marketing profiles — purge on the next retention pass.",
        },
      ];
    case "cookies":
      return [
        {
          action: "SUPPRESS_SENDS",
          target: "analytics",
          reason: "Withdrawn consent ends analytics collection immediately.",
        },
        {
          action: "SCHEDULE_PURGE",
          target: "analytics-ids",
          reason: "No statutory hold covers analytics identifiers.",
        },
      ];
    case "privacy":
    case "terms":
      return [
        {
          action: "REVIEW",
          target: consentKey,
          reason:
            "Contract/legal-obligation stores cannot be purged on withdrawal alone — human review under Art. 17(3)(b).",
        },
      ];
    default:
      return [
        {
          action: "REVIEW",
          target: consentKey,
          reason: "Unknown consent key — human review, never auto-purge.",
        },
      ];
  }
}
