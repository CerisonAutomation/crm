import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import {
  closeConversation,
  reopenConversation,
  archiveConversation,
  assignConversation,
} from "@/lib/communications/conversation-service";

// POST /api/conversations/[id]/actions — close, reopen, archive, or assign.
//
// Body: { action: "close" | "reopen" | "archive" | "assign", ownerId? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    const body = await readJson<{ action: string; ownerId?: string }>(r);
    if (!body.action) throw new DomainError("action required", 400);

    // All actions require staff capability.
    requireCapability(ctx, "admin.manage");

    switch (body.action) {
      case "close":
        await closeConversation(id);
        break;
      case "reopen":
        await reopenConversation(id);
        break;
      case "archive":
        await archiveConversation(id);
        break;
      case "assign":
        if (!body.ownerId) throw new DomainError("ownerId required for assign", 400);
        await assignConversation(id, body.ownerId);
        break;
      default:
        throw new DomainError("Unknown action", 400);
    }

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: `conversation.${body.action}`,
      target: id,
    });
    return jsonOk({ ok: true });
  })(req);
}