import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import {
  createProgrammeRequirement,
  getProgrammeRequirements,
} from "@/lib/services/programme-requirement";
import { notFound, validationFailed } from "@/lib/api-errors";

// Programme catalogue rows are shared across organisations (Programme carries no
// orgId), so the parent programme is resolved and its existence verified before
// any requirement is read or written.
async function ownedProgramme(id: string) {
  const programme = await db.programme.findUnique({ where: { id }, select: { id: true } });
  if (!programme) throw notFound("Programme not found");
  return programme;
}

// GET /api/programmes/[id]/requirements
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const { id } = await params;
    await ownedProgramme(id);
    const requirements = await getProgrammeRequirements({ programmeId: id });
    return jsonOk({ requirements });
  })(req);
}

// POST /api/programmes/[id]/requirements
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedProgramme(id);
    const body = await readJson<{
      versionId?: string;
      key?: string;
      title?: string;
      description?: string;
      windowDays?: number;
      appliesTo?: "PRIMARY" | "SPOUSE" | "CHILD" | "ALL";
      apostille?: boolean;
      translation?: boolean;
    }>(r);
    if (!body?.versionId) throw validationFailed("versionId is required");
    if (!body?.key) throw validationFailed("key is required");
    if (!body?.title) throw validationFailed("title is required");
    const requirement = await createProgrammeRequirement({
      programmeId: id,
      versionId: body.versionId,
      key: body.key,
      title: body.title,
      description: body.description,
      windowDays: body.windowDays,
      appliesTo: body.appliesTo,
      apostille: body.apostille,
      translation: body.translation,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "programme_requirement.created",
      target: requirement.id,
      after: { programmeId: id, key: requirement.key, versionId: body.versionId },
      correlationId,
    });
    return jsonOk({ requirement }, 201);
  })(req);
}
