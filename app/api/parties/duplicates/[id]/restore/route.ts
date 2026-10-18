import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, actorLabel } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  findPriorMergeRoot,
  getDuplicateCandidateRoot,
  loadMergeRecordRoot,
  reversePartyMergeRoot,
} from "@/lib/duplicate-merge/composition";
async function restoreRecordFor(orgId: string, candidateId: string) {
  const candidate = await getDuplicateCandidateRoot(candidateId);
  if (!candidate || candidate.orgId !== orgId)
    throw new DomainError("Duplicate candidate not found", 404);
  const orientations: Array<[string, string]> = [
    [candidate.partyId, candidate.candidatePartyId],
    [candidate.candidatePartyId, candidate.partyId],
  ];
  for (const pair of orientations) {
    const prior = await findPriorMergeRoot(orgId, pair[0], pair[1]);
    if (!prior) continue;
    const bundle = await loadMergeRecordRoot(orgId, prior.id);
    if (bundle) return bundle;
  }
  throw new DomainError("No merge on record for this pair", 404);
}

export const dynamic = "force-dynamic";

// GET returns the merge record + four-eyes state for the restore confirm screen.
// POST executes the reversal. Body: { reason }.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const bundle = await restoreRecordFor(ctx.orgId, (await params).id);
    return jsonOk(bundle);
  })(req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "party.merge");
    const body = await readJson<{ reason?: string }>(r);
    if (!body?.reason || body.reason.trim().length === 0) {
      throw new DomainError("a reason note is required to restore", 400);
    }
    const { id } = await params;
    const bundle = await restoreRecordFor(ctx.orgId, id);
    const res = await reversePartyMergeRoot({
      ledgerId: bundle.record.ledgerId,
      orgId: ctx.orgId,
      reverserId: ctx.userId,
      reverserLabel: actorLabel(ctx),
      reason: body.reason,
      correlationId,
    });
    if (!res.ok) {
      if (
        res.error.indexOf("another organisation") >= 0 ||
        res.error.indexOf("not found") >= 0
      )
        throw new DomainError(res.error, 404);
      if (res.error.indexOf("four-eyes") >= 0)
        throw new DomainError(res.error, 403);
      throw new DomainError(res.error, 400);
    }
    return jsonOk(
      {
        ledgerId: res.ledgerId,
        absorbedId: res.absorbedId,
        receipt: res.receipt,
      },
      201
    );
  })(req);
}
