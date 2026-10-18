import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createAttachment, getAttachments } from "@/lib/services/attachment";
import { validationFailed } from "@/lib/api-errors";

// GET /api/attachments?caseId=&messageId= — read capability only.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const q = new URL(r.url).searchParams;
    const attachments = await getAttachments(ctx.orgId, {
      caseId: q.get("caseId") || undefined,
      messageId: q.get("messageId") || undefined,
    });
    return jsonOk({ attachments });
  })(req);
}

// POST /api/attachments — a write, so it takes the ADMIN-only capability.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      storageKey?: string;
      caseId?: string;
      messageId?: string;
    }>(r);
    if (!body?.fileName) throw validationFailed("fileName is required");
    if (!body?.mimeType) throw validationFailed("mimeType is required");
    if (!body?.storageKey) throw validationFailed("storageKey is required");
    const attachment = await createAttachment({
      orgId: ctx.orgId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      storageKey: body.storageKey,
      caseId: body.caseId,
      messageId: body.messageId,
      uploadedBy: ctx.userId,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "attachment.created",
      target: attachment.id,
      after: { fileName: attachment.fileName, caseId: attachment.caseId ?? null },
      correlationId,
    });
    return jsonOk({ attachment }, 201);
  })(req);
}
