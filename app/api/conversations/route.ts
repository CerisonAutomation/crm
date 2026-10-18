import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { listConversations, createOrMergeConversation, type ConversationChannel } from "@/lib/communications/conversation-service";

// GET /api/conversations — inbox listing for the current user's desk.
//
// Scoped by role:
//   CLIENT  — only conversations on their own cases
//   RM/SENIOR_RM — conversations assigned to them, or unassigned, within their org
//   ADMIN — full org listing
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const url = new URL(r.url);
    const caseId = url.searchParams.get("caseId") || undefined;
    const partyId = url.searchParams.get("partyId") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const channel = url.searchParams.get("channel") as ConversationChannel | null;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 100);
    const offset = Number(url.searchParams.get("offset") ?? "0");

    const result = await listConversations({
      orgId: ctx.orgId,
      status: status as "OPEN" | "CLOSED" | "ARCHIVED" | undefined,
      channel: channel ?? undefined,
      caseId,
      partyId,
      limit,
      offset,
    });
    return jsonOk({ conversations: result });
  })(req);
}

// POST /api/conversations — create or merge a conversation, or send a message into one.
//
// Body:
//   { action: "create", caseId?, partyId, channel, subject?, ownerId?, participantIds? }
//   { action: "send", conversationId, senderType, content, contentType?, replyToId? }
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action: string;
      caseId?: string;
      partyId?: string;
      channel?: string;
      subject?: string;
      ownerId?: string;
      participantIds?: string[];
      conversationId?: string;
      senderType?: string;
      content?: string;
      contentType?: string;
      replyToId?: string;
    }>(r);

    if (body.action === "create") {
      if (!body.channel) throw new DomainError("channel required", 400);
      const convo = await createOrMergeConversation({
        orgId: ctx.orgId,
        caseId: body.caseId,
        partyId: body.partyId,
        channel: body.channel as ConversationChannel,
        subject: body.subject,
        ownerId: body.ownerId,
        participantIds: body.participantIds,
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "conversation.created",
        target: convo.id,
      });
      return jsonOk({ conversation: convo }, 201);
    }

    if (body.action === "send") {
      if (!body.conversationId || !body.content?.trim()) {
        throw new DomainError("conversationId and content required", 400);
      }
      // Lazy import to avoid a circular dependency at module load.
      const { sendMessage } = await import("@/lib/communications/conversation-service");
      const msg = await sendMessage({
        conversationId: body.conversationId,
        senderId: ctx.userId,
        senderType: (body.senderType as "USER" | "CLIENT" | "SYSTEM" | "AI") ?? "USER",
        content: body.content.trim(),
        contentType: body.contentType,
        replyToId: body.replyToId,
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "message.sent",
        target: body.conversationId,
      });
      return jsonOk({ message: msg }, 201);
    }

    throw new DomainError("Unknown conversation action", 400);
  })(req);
}