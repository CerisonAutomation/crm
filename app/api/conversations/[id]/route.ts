import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { getConversation } from "@/lib/communications/conversation-service";

// GET /api/conversations/[id] — full conversation with messages and participants.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const { id } = await params;
    const convo = await getConversation(id);
    if (!convo) throw new DomainError("Conversation not found", 404);
    // Object-level authorisation: client may only read their own case's conversations.
    if (ctx.role === "CLIENT") {
      if (convo.case?.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    } else if (convo.orgId !== ctx.orgId) {
      throw new DomainError("Forbidden", 403);
    }
    return jsonOk({ conversation: convo });
  })(req);
}