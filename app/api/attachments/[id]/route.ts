import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, audit, actorLabel } from "@/lib/api-helpers";
import { getAttachment, deleteAttachment } from "@/lib/services/attachment";
import { notFound } from "@/lib/api-errors";

// DELETE /api/attachments/[id] — remove an attachment record.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const existing = await getAttachment(id);
    if (!existing || existing.orgId !== ctx.orgId) throw notFound("Attachment not found");
    await deleteAttachment(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "attachment.deleted",
      target: id,
      before: { fileName: existing.fileName },
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
