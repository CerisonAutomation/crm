import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { programmeByKey } from "@/lib/domain/programmes";
import {
  prismaScoreStore,
  scoreAuditSink,
} from "@/lib/adapters/submission-scores";
import {
  overrideSubmissionScore,
  recordSubmissionScore,
  scoreHistory,
  type ScoreDeps,
  type ScoreDocEvidence,
} from "@/lib/services/submission-readiness";

/**
 * Score composition root: the ONLY place the Prisma store meets the service.
 * GET — latest + history (same visibility as evidence-readiness).
 * POST — record a computed score (desk, triage.run) or override one
 * (desk approval cap, note required, append-only history).
 */
const deps: ScoreDeps = { store: prismaScoreStore, audit: scoreAuditSink };

async function loadCase(id: string) {
  return db.case.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      clientId: true,
      programme: { select: { key: true } },
    },
  });
}

function scopeCase(
  ctx: { role: string; userId: string; orgId: string },
  c: { clientId: string; orgId: string }
): void {
  if (ctx.role === "CLIENT" && c.clientId !== ctx.userId)
    throw new DomainError("Forbidden", 403);
  if (c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const c = await loadCase(id);
    if (!c) throw new DomainError("Case not found", 404);
    scopeCase(ctx, c);
    const history = await scoreHistory(deps, { id: c.id, orgId: c.orgId });
    return jsonOk({ latest: history[0] ?? null, history });
  })(req);
}

type RecordBody = {
  action?: "record";
  programmeKey?: string;
  documents?: ScoreDocEvidence[];
  screeningDone?: Array<string | null | undefined>;
  sofSubmitted?: boolean;
  sofHasEvidence?: boolean;
};

type OverrideBody = {
  action: "override";
  baseId: string;
  effectiveScore: number;
  note: string;
};

const DOC_STATUSES = [
  "CURRENT",
  "MISSING",
  "EXPIRED",
  "EXPIRING_SOON",
] as const;
const EVIDENCE_TIERS = ["VERIFIED", "OBSERVED", "UNKNOWN", "NONE"] as const;

const ScoreDocEvidenceSchema = z.object({
  key: z.string().min(1),
  status: z.enum(DOC_STATUSES),
  evidence: z.enum(EVIDENCE_TIERS),
  weakReason: z.string().optional(),
});

const RecordScoreBodySchema = z.object({
  action: z.literal("record").optional(),
  programmeKey: z.string().min(1).optional(),
  documents: z.array(ScoreDocEvidenceSchema).optional(),
  screeningDone: z.array(z.string().nullable()).optional(),
  sofSubmitted: z.boolean().optional(),
  sofHasEvidence: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await readJson<RecordBody | OverrideBody>(r);
    const c = await loadCase(id);
    if (!c) throw new DomainError("Case not found", 404);
    scopeCase(ctx, c);
    const actor = {
      id: ctx.userId,
      role: ctx.role,
      label: ctx.name + " [" + ctx.role + "]",
    };
    const kase = { id: c.id, orgId: c.orgId };
    if (body.action === "override") {
      requireCapability(ctx, "case.approve.data");
      const history = await scoreHistory(deps, kase);
      const base = history.find((s) => s.id === body.baseId);
      if (!base) throw new DomainError("Score not found", 404);
      const row = await overrideSubmissionScore(
        deps,
        kase,
        actor,
        { base, effectiveScore: body.effectiveScore, note: body.note ?? "" },
        correlationId
      );
      return jsonOk({ score: row });
    }
    requireCapability(ctx, "triage.run");
    // Boundary validation — an unknown evidence tier or status would otherwise
    // NaN the weighted total and 500 on the INTEGER column.
    const parsedBody = RecordScoreBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError(
        "Invalid score body: " +
          parsedBody.error.issues.map((e) => e.message).join(", "),
        400
      );
    }
    const programmeKey = body.programmeKey ?? c.programme?.key;
    if (!programmeKey || !programmeByKey(programmeKey))
      throw new DomainError("Unknown programme", 400);
    const row = await recordSubmissionScore(
      deps,
      kase,
      actor,
      {
        programmeKey,
        documents: body.documents ?? [],
        screeningDone: body.screeningDone,
        sofSubmitted: body.sofSubmitted,
        sofHasEvidence: body.sofHasEvidence,
      },
      correlationId
    );
    return jsonOk({ score: row });
  })(req);
}
