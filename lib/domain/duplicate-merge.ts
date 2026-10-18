/**
 * Duplicate-merge domain - pure, zero-import duplicate detection + merge planning.
 *
 * Why this module exists: Party rows accumulate duplicates (repeat intake,
 * imports, multi-channel conversations) and the schema already carries the
 * answer tables - DuplicateCandidate (review queue) and MergeLedger (audit
 * trail) - but no scoring, no review discipline and no history-preserving
 * execution. This module is the scoring + rules core both the detection job
 * and the review/merge use-cases share.
 *
 * Pattern reference (patterns only - no code is copied): EspoCRM duplicate
 * detection (weighted field matching with per-signal reasons) + merge with
 * full history preservation (the surviving record keeps everything; the
 * absorbed record is tombstoned, never deleted, and its snapshot lands in
 * the ledger so the merge is reconstructable).
 *
 * Total, dependency-free, Prisma-free: safe to import from client
 * components, routes and unit specs alike.
 */

export interface PartyFacts {
  id: string;
  orgId: string;
  type: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
}

/** Score at or above which a pair enters the review queue. */
export const DUPLICATE_THRESHOLD = 0.6;

export function normalizeEmail(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  return clean.length > 0 ? clean : null;
}

/**
 * Normalise a phone to digits-only with the international prefix folded:
 * leading 00 is stripped so +41 79, 0041 79 and 4179 forms compare equal.
 * A result shorter than 7 digits is not a usable key.
 */
export function normalizePhone(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 7 ? digits : null;
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function nameTokens(normalised: string): Set<string> {
  return new Set(normalised.split(" ").filter(Boolean));
}

/** Jaccard similarity over name tokens (0..1); exact match short-circuits to 1. */
export function nameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface PairScore {
  score: number;
  reasons: string[];
}

/**
 * EspoCRM-style weighted pair score. Two independent strong keys (email +
 * phone) always clear the threshold; one strong key needs a corroborating
 * name; weak signals alone never queue. A shared inbox (same email, different
 * names) therefore stays OUT of the queue - unhappy-first by construction.
 */
export function scorePartyPair(a: PartyFacts, b: PartyFacts): PairScore {
  const reasons: string[] = [];
  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  const emailExact = emailA !== null && emailA === emailB;
  const phoneExact = phoneA !== null && phoneA === phoneB;
  const nameSim = nameSimilarity(a.name, b.name);
  const companyA = normalizeName(a.company);
  const companyB = normalizeName(b.company);
  const companyExact = companyA.length > 0 && companyA === companyB;

  if (emailExact) reasons.push("email:exact");
  if (phoneExact) reasons.push("phone:exact");
  if (nameSim >= 1) reasons.push("name:exact");
  else if (nameSim >= 0.5) reasons.push("name:similar:" + nameSim.toFixed(2));
  if (companyExact) reasons.push("company:exact");

  let score: number;
  if (emailExact && phoneExact) {
    score = 0.95;
  } else if (emailExact && nameSim >= 0.5) {
    score = 0.7 + 0.2 * nameSim;
  } else if (phoneExact && nameSim >= 0.66) {
    score = 0.6 + 0.2 * nameSim;
  } else {
    score =
      (emailExact ? 0.55 : 0) +
      (phoneExact ? 0.3 : 0) +
      0.25 * nameSim +
      (companyExact ? 0.1 : 0);
  }
  return { score: Math.min(Math.round(score * 100) / 100, 1), reasons };
}

export interface DuplicatePair {
  partyId: string;
  candidatePartyId: string;
  score: number;
  reasons: string[];
}

/**
 * Detection sweep over one organisation's parties: every unordered pair at or
 * above the threshold, sorted by score descending. Tombstoned (MERGED) rows
 * never seed new candidates - history is preserved, not re-queued.
 */
export function findDuplicatePairs(
  parties: PartyFacts[],
  threshold = DUPLICATE_THRESHOLD
): DuplicatePair[] {
  const live = parties.filter((p) => p.status !== "MERGED");
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const left = live[i];
      const right = live[j];
      if (left.orgId !== right.orgId) continue;
      const scored = scorePartyPair(left, right);
      if (scored.score >= threshold) {
        pairs.push({
          partyId: left.id,
          candidatePartyId: right.id,
          score: scored.score,
          reasons: scored.reasons,
        });
      }
    }
  }
  return pairs.sort(
    (x, y) => y.score - x.score || (x.partyId < y.partyId ? -1 : 1)
  );
}

// Four-eyes (R5/C6): reviewer != reporter

/**
 * Null = may proceed; a string = the unhappy reason. The reporter may be the
 * system detection job, but the reviewer must be a named human distinct from
 * the reporter - a self-approved merge is the control failure this slice
 * exists to prevent.
 */
export function checkFourEyes(
  reportedBy: string | null | undefined,
  reviewer: string | null | undefined
): string | null {
  if (!reviewer || reviewer.trim().length === 0)
    return "four-eyes: reviewer is required";
  if (reviewer === "system")
    return "four-eyes: the system reporter cannot review its own candidate";
  if (reportedBy && reviewer === reportedBy)
    return "four-eyes: reviewer must differ from reporter";
  return null;
}

// Review transitions (R5: REJECT needs a note)

export type ReviewDecision = "CONFIRM" | "DISMISS";
export type CandidateStatus = "PENDING" | "CONFIRMED" | "DISMISSED";

/** Null = transition allowed; a string = the unhappy reason. */
export function checkReviewTransition(
  current: string,
  decision: ReviewDecision,
  reason: string | null | undefined
): string | null {
  if (current !== "PENDING")
    return (
      "review: candidate is already " +
      current +
      " - terminal, cannot re-review"
    );
  if (decision === "DISMISS" && (!reason || reason.trim().length === 0)) {
    return "review: dismissing a candidate needs a reason note";
  }
  return null;
}

export function reviewTargetStatus(decision: ReviewDecision): CandidateStatus {
  return decision === "CONFIRM" ? "CONFIRMED" : "DISMISSED";
}

// History-preserving merge plan

export interface MergePlan {
  orgId: string;
  survivorId: string;
  absorbedId: string;
  /** Absorbed values that fill gaps in the survivor (survivor wins every conflict). */
  fieldFills: Partial<
    Pick<PartyFacts, "email" | "phone" | "company"> & { name: string }
  >;
  /** Full absorbed snapshot - persisted into the ledger so the merge is reconstructable. */
  absorbedSnapshot: PartyFacts;
  survivorSnapshot: PartyFacts;
  /** Relation tables re-pointed from the absorbed row to the survivor. */
  movedRelations: Array<"externalIdentities" | "conversations">;
}

/** Null plan fields + unhappy reason when the merge must not proceed. */
export function planMerge(
  orgId: string,
  survivor: PartyFacts,
  absorbed: PartyFacts
): { ok: true; plan: MergePlan } | { ok: false; error: string } {
  if (survivor.id === absorbed.id)
    return { ok: false, error: "merge: cannot merge a party into itself" };
  if (survivor.orgId !== orgId || absorbed.orgId !== orgId) {
    return {
      ok: false,
      error: "merge: both parties must belong to the calling organisation",
    };
  }
  if (survivor.status === "MERGED")
    return {
      ok: false,
      error: "merge: the surviving party is itself merged away",
    };
  if (absorbed.status === "MERGED")
    return {
      ok: false,
      error: "merge: the absorbed party is already merged (idempotent re-run)",
    };

  const fieldFills: MergePlan["fieldFills"] = {};
  if (!normalizeName(survivor.name) && normalizeName(absorbed.name))
    fieldFills.name = absorbed.name;
  if (!normalizeEmail(survivor.email) && normalizeEmail(absorbed.email))
    fieldFills.email = absorbed.email;
  if (!normalizePhone(survivor.phone) && normalizePhone(absorbed.phone))
    fieldFills.phone = absorbed.phone;
  if (!normalizeName(survivor.company) && normalizeName(absorbed.company))
    fieldFills.company = absorbed.company;

  return {
    ok: true,
    plan: {
      orgId,
      survivorId: survivor.id,
      absorbedId: absorbed.id,
      fieldFills,
      absorbedSnapshot: { ...absorbed },
      survivorSnapshot: { ...survivor },
      movedRelations: ["externalIdentities", "conversations"],
    },
  };
}

// Merge reversal (MERGE-PLUS): restore a tombstoned merge.

export type MergeFieldFills = Partial<
  Pick<PartyFacts, "email" | "phone" | "company"> & { name: string }
>;

export interface MergeRecordLike {
  ledgerId: string;
  orgId: string;
  survivorId: string;
  absorbedId: string;
  performedBy: string | null;
  confirmerId: string | null;
  survivorSnapshot: PartyFacts | null;
  absorbedSnapshot: PartyFacts | null;
  fieldFills: MergeFieldFills;
  movedExternalIdentityIds: string[] | null;
  movedConversationIds: string[] | null;
}

export interface RestorePlan {
  orgId: string;
  ledgerId: string;
  survivorId: string;
  absorbedId: string;
  survivorRollback: Partial<MergeFieldFills>;
  moveBackExternalIdentityIds: string[];
  moveBackConversationIds: string[];
}

export function checkRestoreFourEyes(
  record: Pick<MergeRecordLike, "performedBy" | "confirmerId">,
  reverser: string | null | undefined
): string | null {
  if (!reverser || reverser.trim().length === 0)
    return "restore: reverser is required";
  if (reverser === "system")
    return "restore: the system reporter cannot reverse a merge";
  if (record.performedBy && reverser === record.performedBy)
    return "restore: reverser must differ from the merge performer";
  if (record.confirmerId && reverser === record.confirmerId)
    return "restore: reverser must differ from the confirmer";
  return null;
}

export type RollbackKey = "email" | "phone" | "company" | "name";

export function planRestore(
  orgId: string,
  record: MergeRecordLike,
  currentSurvivor: PartyFacts | null,
  currentAbsorbed: PartyFacts | null
): { ok: true; plan: RestorePlan } | { ok: false; error: string } {
  if (record.orgId !== orgId)
    return {
      ok: false,
      error: "restore: merge belongs to another organisation",
    };
  const moveIds = record.movedExternalIdentityIds;
  const moveConv = record.movedConversationIds;
  if (moveIds === null || moveConv === null)
    return {
      ok: false,
      error:
        "restore: this merge predates move tracking and cannot be reversed automatically",
    };
  if (!currentAbsorbed)
    return { ok: false, error: "restore: absorbed party no longer exists" };
  if (currentAbsorbed.status !== "MERGED")
    return {
      ok: false,
      error:
        "restore: absorbed party is " +
        currentAbsorbed.status +
        " - nothing to restore",
    };
  if (!currentSurvivor)
    return { ok: false, error: "restore: surviving party no longer exists" };
  if (currentSurvivor.status === "MERGED")
    return {
      ok: false,
      error:
        "restore: surviving party is itself merged away - restore it first",
    };
  if (currentSurvivor.orgId !== orgId || currentAbsorbed.orgId !== orgId)
    return {
      ok: false,
      error: "restore: both parties must belong to the calling organisation",
    };
  const snap = record.survivorSnapshot;
  if (!snap)
    return {
      ok: false,
      error: "restore: pre-merge snapshot missing - manual review needed",
    };
  const rollback: Partial<MergeFieldFills> = {};
  const drifted: string[] = [];
  (Object.keys(record.fieldFills) as RollbackKey[]).forEach(function (key) {
    const filled: unknown = record.fieldFills[key];
    const current: unknown = currentSurvivor[key];
    if (current !== filled) drifted.push(key);
    else {
      const prior: unknown = snap[key];
      if (typeof prior === "string") {
        if (key === "name") rollback.name = prior;
        else if (key === "email") rollback.email = prior;
        else if (key === "phone") rollback.phone = prior;
        else rollback.company = prior;
      } else if (prior === null || prior === undefined) {
        if (key === "name") drifted.push(key);
        else if (key === "email") rollback.email = null;
        else if (key === "phone") rollback.phone = null;
        else rollback.company = null;
      } else {
        drifted.push(key);
      }
    }
  });
  if (drifted.length > 0)
    return {
      ok: false,
      error:
        "restore: survivor changed since the merge (" +
        drifted.join(", ") +
        ") - manual review needed",
    };
  return {
    ok: true,
    plan: {
      orgId: orgId,
      ledgerId: record.ledgerId,
      survivorId: record.survivorId,
      absorbedId: record.absorbedId,
      survivorRollback: rollback,
      moveBackExternalIdentityIds: moveIds,
      moveBackConversationIds: moveConv,
    },
  };
}
