import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createParty, getParties } from "@/lib/services/party";
import { validationFailed } from "@/lib/api-errors";

// GET /api/parties?type= — tenant-scoped party ledger.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const type = new URL(r.url).searchParams.get("type") || undefined;
    const parties = await getParties(ctx.orgId, type);
    return jsonOk({ parties });
  })(req);
}

// POST /api/parties — create a party inside the caller's organisation.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      name?: string;
      type?: "INDIVIDUAL" | "COMPANY";
      email?: string;
      phone?: string;
      company?: string;
    }>(r);
    if (!body?.name) throw validationFailed("Name is required");
    const party = await createParty({
      orgId: ctx.orgId,
      name: body.name,
      type: body.type,
      email: body.email,
      phone: body.phone,
      company: body.company,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "party.created",
      target: party.id,
      after: { type: party.type, name: party.name },
      correlationId,
    });
    return jsonOk({ party }, 201);
  })(req);
}
