"use client";

import { useEffect, useState } from "react";
import { ApiError, get, post } from "@/lib/api-client";

type Conversation = { id: string; channel: string; subject: string; status: string; lastMessageAt: string | null; messageCount: number; party: { name: string; email: string | null } | null; case: { reference: string } | null };

export function ChannelInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => { get<{ conversations: Conversation[] }>("/api/conversations?status=OPEN&limit=50").then((response) => { setConversations(response.conversations); setSelected(response.conversations[0] ?? null); }).catch((reason: unknown) => setError(reason instanceof ApiError ? reason.message : "Conversations could not be loaded.")).finally(() => setLoading(false)); }, []);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !message.trim()) return;
    setSending(true); setError(null);
    try { await post("/api/conversations", { action: "send", conversationId: selected.id, senderType: "USER", content: message.trim() }); setMessage(""); setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, messageCount: item.messageCount + 1, lastMessageAt: new Date().toISOString() } : item)); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "The message could not be sent."); }
    finally { setSending(false); }
  }

  return <section className="grid overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[20rem_minmax(0,1fr)]"><aside className="border-b lg:border-b-0 lg:border-r"><div className="p-5"><p className="text-sm font-medium text-primary">Unified communications</p><h2 className="text-xl font-semibold">Channel inbox</h2></div>{loading && <p className="px-5 pb-5 text-sm text-muted-foreground" role="status">Loading conversations…</p>}<div className="max-h-[36rem] overflow-y-auto">{conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => setSelected(conversation)} className={`w-full border-t px-5 py-4 text-left ${selected?.id === conversation.id ? "bg-accent" : "hover:bg-accent/50"}`}><div className="flex justify-between gap-3"><span className="font-medium">{conversation.party?.name ?? conversation.case?.reference ?? "Unassigned conversation"}</span><span className="text-xs text-muted-foreground">{conversation.channel}</span></div><p className="mt-1 truncate text-sm text-muted-foreground">{conversation.subject || "No subject"}</p><p className="mt-1 text-xs text-muted-foreground">{conversation.messageCount} messages</p></button>)}{!loading && conversations.length === 0 && <p className="p-5 text-sm text-muted-foreground">No open conversations.</p>}</div></aside><div className="flex min-h-96 flex-col p-5"><div><p className="text-sm font-medium text-primary">{selected?.channel ?? "Select a conversation"}</p><h2 className="mt-1 text-xl font-semibold">{selected?.subject || "Conversation inbox"}</h2><p className="mt-2 text-sm text-muted-foreground">{selected?.party?.email ?? selected?.case?.reference ?? "Choose a thread from the inbox to compose a response."}</p></div>{error && <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}<form className="mt-auto pt-8" onSubmit={send}><label className="text-sm font-medium" htmlFor="channel-message">Reply</label><textarea id="channel-message" className="mt-2 min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={message} onChange={(event) => setMessage(event.target.value)} disabled={!selected} maxLength={10000} /><button type="submit" disabled={!selected || !message.trim() || sending} className="mt-3 min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{sending ? "Sending…" : "Send message"}</button></form></div></section>;
}
