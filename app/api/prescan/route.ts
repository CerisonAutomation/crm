import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { runPreScan, rankProgrammes, buildCounterCase, type PreScanAnswers } from "@/lib/services/prescan";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { isFilingRoute, programmeByKey } from "@/lib/domain/programmes";

export const dynamic = "force-dynamic";

/**
 * POST /api/prescan — rule-based eligibility screening.
 *
 * Two shapes, one endpoint:
 *   • { programmeKey, answers }        — screen ONE programme (the compare view)
 *   • { answers }                      — RANK every screenable programme
 *
 * When `caseId` is supplied the outcome is recorded against the case (audit +
 * event fan-out) so the desk has evidence the screening happened. A CLIENT may
 * only screen their OWN case; staff need `prescan.run` for someone else's.
 *
 * The verdict is INDICATIVE. It routes a file to a human; it never decides an
 * application, and the response says so.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      programmeKey?: unknown;
      caseId?: unknown;
      answers?: unknown;
    }>(r as Request as NextRequest);

    const answers = coerceAnswers(body.answers);

    // ── ranking mode: no programme chosen yet ──
    if (typeof body.programmeKey !== "string" || !body.programmeKey) {
      const ranked = rankProgrammes(answers).slice(0, 12);
      return jsonOk({
        mode: "ranked",
        indicative: true,
        note: "Indicative screening only — a Relationship Manager confirms every conclusion.",
        recommendations: ranked,
      });
    }

    const key = body.programmeKey.trim().slice(0, 60);
    const entry = programmeByKey(key);
    if (!entry) throw new DomainError(`Unknown programme "${key}"`, 404);
    if (!isFilingRoute(key)) throw new DomainError("Advisory engagements carry no screening rules", 422);

    const result = runPreScan(key, answers);

    // ── optional: record the screening against a real case ──
    const caseId = typeof body.caseId === "string" ? body.caseId : undefined;
    if (caseId) {
      // Case-anchored screening resolves inside the caller org; the
      // ranking-only path above reads no rows and needs no transaction.
      const kase = await withTenantContext(ctx.orgId, (tx) =>
        tx.case.findUnique({
          where: { id: caseId },
          select: { id: true, reference: true, clientId: true, orgId: true },
        }),
      );
      if (!kase) throw new DomainError("Case not found", 404);

      const isOwner = kase.clientId === ctx.userId;
      if (!isOwner) {
        // Someone else's case: only the desk may screen it.
        if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
        requireCapability(ctx, "prescan.run");
      } else if (!canSelfScreen(ctx.role)) {
        requireCapability(ctx, "prescan.self.own");
      }

      await audit({
        orgId: kase.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "prescan.run",
        target: kase.reference,
        after: {
          programmeKey: key,
          outcome: result.outcome,
          failed: result.factors.filter((f) => f.result === "FAIL").map((f) => f.rule),
          unknown: result.factors.filter((f) => f.result === "UNKNOWN").map((f) => f.rule),
        },
        reason: "Rule-based eligibility pre-scan",
      });

      void emitCaseEvent("prescan.completed", {
        caseId: kase.id,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        meta: {
          result: result.outcome,
          serviceName: result.serviceName,
          programmeKey: key,
        },
        dedupeKey: `prescan:${key}:${result.outcome}`,
      }).catch(() => undefined);

      // A clean screen nudges the queue toward immediate follow-up. This is a
      // scoring refresh, not a case transition — the state machine is untouched.
      if (result.outcome === "ELIGIBLE") {
        const { scoreCase } = await import("@/lib/services/triage");
        void scoreCase(kase.id).catch(() => undefined);
      }
    }

    return jsonOk({
      mode: "programme",
      indicative: true,
      note: "Indicative screening only — a Relationship Manager confirms every conclusion.",
      programmeKey: key,
      programmeLabel: entry.label,
      // The case AGAINST approval, as grounds the desk rebuts one by one rather
      // than a checklist they tick. Advisory: it re-projects the rules above.
      counterCase: buildCounterCase(entry, result),
      ...result,
    });
  })(req);
}

/** Staff roles may screen anyone's case without the per-case capability. */
function canSelfScreen(role: string): boolean {
  return role === "RM" || role === "SENIOR_RM" || role === "ADMIN";
}

/**
 * Coerce the untyped request body into PreScanAnswers. Every field is validated
 * and clamped — an out-of-range or wrongly-typed answer is DROPPED (becoming
 * UNKNOWN in the verdict), never coerced into a passing value.
 */
function coerceAnswers(raw: unknown): PreScanAnswers {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PreScanAnswers = {};

  if (o.nationalityZone === "EU_EFTA" || o.nationalityZone === "NON_EU") {
    out.nationalityZone = o.nationalityZone;
  }
  if (o.permit === "NONE" || o.permit === "L" || o.permit === "B" || o.permit === "C") {
    out.permit = o.permit;
  }
  const num = (v: unknown, max: number): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.floor(v) : undefined;

  const funds = num(o.fundsChf, 10_000_000_000);
  if (funds !== undefined) out.fundsChf = funds;
  const age = num(o.ageYears, 130);
  if (age !== undefined) out.ageYears = age;
  const res = num(o.residenceYears, 130);
  if (res !== undefined) out.residenceYears = res;
  const emp = num(o.employmentMonths, 1_200);
  if (emp !== undefined) out.employmentMonths = emp;

  if (typeof o.willWorkInSwitzerland === "boolean") out.willWorkInSwitzerland = o.willWorkInSwitzerland;
  if (typeof o.livesInBorderZone === "boolean") out.livesInBorderZone = o.livesInBorderZone;

  return out;
}
