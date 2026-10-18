/**
 * Canonical conversation aggregate and inbox read model.
 *
 * One Conversation can span multiple channels (email, chat, WhatsApp) and is
 * linked to a case, party, and participants. Messages are stored separately;
 * this module provides the full conversation lifecycle: create/merge,
 * ingest inbound, send, assign, close/reopen, and inbox queries.
 *
 * This module is the single source of truth for conversation state. All
 * channel adapters (email, WhatsApp, in-app) write through this service so
 * the inbox read model stays consistent.
 */

import { db } from "@/lib/db";

// ── Types ──────────────────────────────────────────────────────────────────

export type ConversationChannel =
  | "IN_APP"
  | "EMAIL"
  | "WHATSAPP"
  | "SMS"
  | "PORTAL";
export type ConversationStatus = "OPEN" | "CLOSED" | "ARCHIVED";
export type MessageType = "USER" | "CLIENT" | "SYSTEM" | "AI";
export type MessageStatus =
  | "DRAFT"
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "BOUNCED";

export type ConversationWithMessages = Awaited<
  ReturnType<typeof getConversation>
>;

// ── Create / Merge ─────────────────────────────────────────────────────────

/**
 * Create a new conversation or merge with an existing one.
 *
 * Deduplication strategy: if a conversation already exists for the same
 * org + case + party + channel, return it instead of creating a duplicate.
 * This prevents the same inquiry from creating multiple threads.
 */
export async function createOrMergeConversation(input: {
  orgId: string;
  caseId?: string;
  partyId?: string;
  channel: ConversationChannel;
  subject?: string;
  ownerId?: string;
  participantIds?: string[];
}) {
  const {
    orgId,
    caseId,
    partyId,
    channel,
    subject = "",
    ownerId,
    participantIds = [],
  } = input;

  // Try to find an existing open conversation for the same org+case+party+channel
  if (caseId && partyId) {
    const existing = await db.conversation.findFirst({
      where: {
        orgId,
        caseId,
        partyId,
        channel,
        status: "OPEN",
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (existing) return existing;
  }

  // Also try without partyId (some conversations are case-only)
  if (caseId && !partyId) {
    const existing = await db.conversation.findFirst({
      where: {
        orgId,
        caseId,
        channel,
        status: "OPEN",
        partyId: null,
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (existing) return existing;
  }

  // Create new conversation
  const conversation = await db.conversation.create({
    data: {
      orgId,
      caseId: caseId ?? null,
      partyId: partyId ?? null,
      channel,
      subject,
      ownerId: ownerId ?? null,
      status: "OPEN",
      messageCount: 0,
    },
  });

  // Add participants
  for (const pid of participantIds) {
    await db.conversationParticipant.create({
      data: {
        conversationId: conversation.id,
        participantId: pid,
        role: pid === ownerId ? "OWNER" : "MEMBER",
      },
    });
  }

  return conversation;
}

// ── Inbound ────────────────────────────────────────────────────────────────

/**
 * Ingest an inbound message from any channel.
 *
 * Creates the message, updates the conversation's lastMessageAt and
 * messageCount, and returns the created message. If the conversation
 * doesn't exist, it's created automatically.
 */
export async function ingestInboundMessage(input: {
  orgId: string;
  conversationId?: string;
  caseId?: string;
  partyId?: string;
  channel: ConversationChannel;
  senderId: string;
  senderType: MessageType;
  content: string;
  contentType?: string;
  providerId?: string;
  replyToId?: string;
  metadata?: Record<string, unknown>;
  subject?: string;
}) {
  const {
    orgId,
    conversationId,
    caseId,
    partyId,
    channel,
    senderId,
    senderType,
    content,
    contentType = "TEXT",
    providerId,
    replyToId,
    metadata,
    subject,
  } = input;

  // Resolve or create conversation
  let convoId = conversationId;
  if (!convoId) {
    const convo = await createOrMergeConversation({
      orgId,
      caseId,
      partyId,
      channel,
      subject,
    });
    convoId = convo.id;
  }

  // Create message
  const message = await db.message.create({
    data: {
      conversationId: convoId,
      senderId,
      senderType,
      content,
      contentType,
      status: "SENT",
      providerId: providerId ?? null,
      replyToId: replyToId ?? null,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
    },
  });

  // Update conversation
  await db.conversation.update({
    where: { id: convoId },
    data: {
      lastMessageAt: message.sentAt,
      messageCount: { increment: 1 },
    },
  });

  return message;
}

// ── Send ───────────────────────────────────────────────────────────────────

/**
 * Send a message through the conversation's channel.
 *
 * Creates the message in SENDING status, then updates to SENT. The actual
 * delivery is handled by the channel adapter (email, WhatsApp, etc.) which
 * updates the status to DELIVERED or FAILED.
 */
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  senderType: MessageType;
  content: string;
  contentType?: string;
  replyToId?: string;
  providerId?: string;
  metadata?: Record<string, unknown>;
}) {
  const {
    conversationId,
    senderId,
    senderType,
    content,
    contentType = "TEXT",
    replyToId,
    providerId,
    metadata,
  } = input;

  const message = await db.message.create({
    data: {
      conversationId,
      senderId,
      senderType,
      content,
      contentType,
      status: "SENT",
      providerId: providerId ?? null,
      replyToId: replyToId ?? null,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
    },
  });

  await db.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: message.sentAt,
      messageCount: { increment: 1 },
    },
  });

  return message;
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Get a conversation with its messages and participants.
 */
export async function getConversation(conversationId: string) {
  return db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { sentAt: "asc" },
        take: 100,
      },
      participants: true,
      case: {
        select: { id: true, reference: true, status: true, clientId: true },
      },
      party: { select: { id: true, name: true, email: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * List conversations for an inbox query.
 * Supports filtering by status, channel, owner, and case.
 */
export async function listConversations(input: {
  orgId: string;
  status?: ConversationStatus;
  channel?: ConversationChannel;
  ownerId?: string;
  caseId?: string;
  partyId?: string;
  limit?: number;
  offset?: number;
}) {
  const {
    orgId,
    status,
    channel,
    ownerId,
    caseId,
    partyId,
    limit = 50,
    offset = 0,
  } = input;

  return db.conversation.findMany({
    where: {
      orgId,
      ...(status ? { status } : {}),
      ...(channel ? { channel } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(caseId ? { caseId } : {}),
      ...(partyId ? { partyId } : {}),
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      party: { select: { id: true, name: true, email: true } },
      case: { select: { id: true, reference: true, status: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    skip: offset,
  });
}

/**
 * Get the last N messages in a conversation (for inbox preview).
 */
export async function getRecentMessages(conversationId: string, limit = 5) {
  return db.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    take: limit,
  });
}

// ── Assign / Close / Reopen ───────────────────────────────────────────────

/**
 * Assign a conversation to an RM/staff member.
 */
export async function assignConversation(
  conversationId: string,
  ownerId: string
) {
  return db.conversation.update({
    where: { id: conversationId },
    data: { ownerId },
  });
}

/**
 * Close a conversation.
 */
export async function closeConversation(conversationId: string) {
  return db.conversation.update({
    where: { id: conversationId },
    data: { status: "CLOSED" },
  });
}

/**
 * Reopen a closed conversation.
 */
export async function reopenConversation(conversationId: string) {
  return db.conversation.update({
    where: { id: conversationId },
    data: { status: "OPEN" },
  });
}

/**
 * Archive a conversation.
 */
export async function archiveConversation(conversationId: string) {
  return db.conversation.update({
    where: { id: conversationId },
    data: { status: "ARCHIVED" },
  });
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Merge a source conversation into a target conversation.
 * All messages from the source are re-parented to the target, and the
 * source is archived.
 */
export async function mergeConversations(sourceId: string, targetId: string) {
  // Re-parent messages
  await db.message.updateMany({
    where: { conversationId: sourceId },
    data: { conversationId: targetId },
  });

  // Update target message count
  const sourceCount = await db.message.count({
    where: { conversationId: targetId },
  });
  await db.conversation.update({
    where: { id: targetId },
    data: { messageCount: sourceCount },
  });

  // Archive source
  await db.conversation.update({
    where: { id: sourceId },
    data: { status: "ARCHIVED" },
  });

  return getConversation(targetId);
}

// ── Delivery Status ────────────────────────────────────────────────────────

/**
 * Update a message's delivery status.
 * Called by channel adapters when a delivery receipt arrives.
 */
export async function updateMessageStatus(
  messageId: string,
  status: MessageStatus,
  providerId?: string
) {
  return db.message.update({
    where: { id: messageId },
    data: {
      status,
      ...(providerId ? { providerId } : {}),
    },
  });
}

/**
 * Get all messages with a specific delivery status (for reconciliation).
 */
export async function getMessagesByStatus(status: MessageStatus, limit = 100) {
  return db.message.findMany({
    where: { status },
    orderBy: { sentAt: "asc" },
    take: limit,
  });
}
