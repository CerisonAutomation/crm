"use client";

/**
 * Admin Conversation Inbox — the unified communications panel.
 *
 * Lists all conversations in the org, lets the admin open one to see its
 * messages, send a reply, close/reopen/archive it, or assign it to a team
 * member. Uses the conversation-service through the typed API client.
 */
import { useState } from "react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Conversation = {
  id: string;
  orgId: string;
  caseId: string | null;
  partyId: string | null;
  channel: string;
  status: string;
  subject: string;
  ownerId: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  senderId: string;
  senderType: string;
  content: string;
  sentAt: string;
};

type ConversationDetail = Conversation & {
  messages: Message[];
  participants: Array<{ id: string; participantId: string; role: string }>;
  owner: { id: string; name: string; email: string } | null;
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "border-emerald-700/40 bg-emerald-700/10 text-emerald-800",
  CLOSED: "border-border bg-muted text-muted-foreground",
  ARCHIVED: "border-border bg-muted text-muted-foreground",
};

const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: "In-app",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  PORTAL: "Portal",
};

export function ConversationInboxPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listConversations({ limit: "50" });
      setConversations(res.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }

  async function openConversation(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    setDetail(null);
    setError(null);
    try {
      const res = await api.getConversation(id);
      setDetail(res.conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversation");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendConversationMessage(selectedId, { content: reply.trim() });
      setReply("");
      await openConversation(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  }

  async function doAction(action: "close" | "reopen" | "archive") {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await api.conversationAction(selectedId, action);
      await openConversation(selectedId);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Loading conversations…
      </div>
    );
  }

  if (error && conversations.length === 0) {
    return (
      <div className="p-8">
        <div className="border-l-2 border-[#8C2F2F] bg-[#8C2F2F]/[0.05] px-3 py-2 text-sm text-danger-ink">
          {error}
        </div>
        <Button
          variant="outline"
          onClick={() => void loadList()}
          className="mt-4"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* ── Conversation list ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-editorial text-lg text-cobble-ink">
            Conversations
          </h2>
          <Button variant="outline" size="sm" onClick={() => void loadList()}>
            Refresh
          </Button>
        </div>
        <ul className="mt-4 space-y-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void openConversation(c.id)}
                className={cn(
                  "w-full border p-3 text-left transition-colors",
                  selectedId === c.id
                    ? "border-gold/60 bg-gold/[0.05]"
                    : "border-border/70 bg-card hover:border-cobble"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-cobble-ink">
                    {c.subject || c.id.slice(0, 8)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]",
                      STATUS_STYLES[c.status] ?? STATUS_STYLES.OPEN
                    )}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
                  <span>·</span>
                  <span>
                    {c.messageCount} msg{c.messageCount !== 1 ? "s" : ""}
                  </span>
                  {c.lastMessageAt && (
                    <>
                      <span>·</span>
                      <span>
                        {new Date(c.lastMessageAt).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </button>
            </li>
          ))}
          {conversations.length === 0 && (
            <li className="p-4 text-center text-sm text-muted-foreground">
              No conversations yet.
            </li>
          )}
        </ul>
      </div>

      {/* ── Conversation detail ───────────────────────────────────────── */}
      <div>
        {loadingDetail && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {!loadingDetail && !detail && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Select a conversation to view its messages.
          </div>
        )}

        {!loadingDetail && detail && (
          <div>
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-editorial text-lg text-cobble-ink">
                  {detail.subject || detail.id.slice(0, 8)}
                </h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {CHANNEL_LABELS[detail.channel] ?? detail.channel}
                  {detail.owner && ` · Assigned to ${detail.owner.name}`}
                  {!detail.owner && " · Unassigned"}
                </p>
              </div>
              <div className="flex gap-2">
                {detail.status === "OPEN" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void doAction("close")}
                  >
                    Close
                  </Button>
                )}
                {detail.status === "CLOSED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void doAction("reopen")}
                  >
                    Reopen
                  </Button>
                )}
                {detail.status !== "ARCHIVED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void doAction("archive")}
                  >
                    Archive
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="mt-4 max-h-[400px] space-y-3 overflow-y-auto border border-border/70 bg-card p-4">
              {detail.messages.map((m) => (
                <div key={m.id} data-message={m.id} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cobble text-[10px] font-medium text-[#F5F1EA]">
                    {m.senderType === "USER"
                      ? "U"
                      : m.senderType === "CLIENT"
                      ? "C"
                      : m.senderType === "SYSTEM"
                      ? "S"
                      : "A"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-cobble-ink">
                        {m.senderType}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(m.sentAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-iron-ink">
                      {m.content}
                    </p>
                  </div>
                </div>
              ))}
              {detail.messages.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No messages yet.
                </p>
              )}
            </div>

            {/* Reply */}
            {detail.status === "OPEN" && (
              <div className="mt-4">
                <div className="flex gap-2">
                  <Input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendReply();
                      }
                    }}
                    placeholder="Type a reply…"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => void sendReply()}
                    disabled={busy || !reply.trim()}
                    className="cta focus-gold"
                  >
                    Send
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 border-l-2 border-[#8C2F2F] bg-[#8C2F2F]/[0.05] px-3 py-2 text-sm text-danger-ink">
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
