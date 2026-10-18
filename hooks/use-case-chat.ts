"use client";

/**
 * useCaseChat — case thread, kept current by polling.
 *
 * Transport: the thread is refreshed by REST polling (~5s) against
 * /api/messages, and send() always persists via POST /api/messages, so a
 * message is never lost even if a poll is missed. A live socket fan-out used to
 * ride on a third-party realtime service; the app now runs on its own
 * infrastructure only, so polling is the single transport.
 *
 * `connected` reports whether a live push channel exists — always false now,
 * hence `lastSendVia` is always "fallback". Presence and typing had no polling
 * equivalent and are therefore always empty/null. The returned object keeps the
 * same shape so callers did not need to change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

export type ChatMessage = {
  id: string;
  caseId?: string;
  body: string;
  createdAt: number;
  author: { name: string; role: string };
  attachment?: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
};

export type ChatPresenceUser = { userId: string; name: string; role: string };

type SendVia = "socket" | "fallback" | null;

const POLL_MS = 5_000;

export function useCaseChat(
  caseId: string | null,
  opts?: { onMessage?: (m: ChatMessage) => void }
) {
  const onMessageRef = useRef<((m: ChatMessage) => void) | undefined>(undefined);
  useEffect(() => {
    onMessageRef.current = opts?.onMessage;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastSendVia, setLastSendVia] = useState<SendVia>(null);
  const caseRef = useRef<string | null>(null);
  const knownIds = useRef<Set<string>>(new Set());

  // No live push channel exists without the realtime service.
  const connected = false;
  const onlineUsers: ChatPresenceUser[] = [];
  const typingUser: string | null = null;

  // Stable message append with id dedupe (overlapping polls can repeat a row).
  const append = useCallback((m: ChatMessage) => {
    if (knownIds.current.has(m.id)) return;
    knownIds.current.add(m.id);
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    onMessageRef.current?.(m);
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    try {
      const res = await api.messages(id);
      for (const m of res.messages) {
        append({ ...m, createdAt: new Date(m.createdAt).getTime() });
      }
    } catch {
      /* history reload failed silently — the poll and retry paths still function */
    } finally {
      setHistoryLoading(false);
    }
  }, [append]);

  useEffect(() => {
    const previous = caseRef.current;
    caseRef.current = caseId;
    if (!caseId) {
      setMessages([]);
      knownIds.current = new Set();
      return;
    }
    if (previous !== caseId) {
      setMessages([]);
      knownIds.current = new Set();
      void loadHistory(caseId);
    }
  }, [caseId, loadHistory]);

  useEffect(() => {
    if (!caseId) return;
    let alive = true;

    const poll = async () => {
      try {
        const res = await api.messages(caseId);
        if (!alive) return;
        for (const m of res.messages) {
          append({ ...m, createdAt: new Date(m.createdAt).getTime() });
        }
      } catch {
        /* poll failed — next tick retries */
      }
    };

    void poll();
    const poller = setInterval(poll, POLL_MS);

    return () => {
      alive = false;
      clearInterval(poller);
    };
  }, [caseId, append]);

  const send = useCallback(
    async (body: string, documentId?: string): Promise<boolean> => {
      const trimmed = body.trim();
      if (!trimmed || !caseId) return false;
      try {
        const res = await api.sendMessage(caseId, trimmed, documentId);
        const m = res.message;
        append({ id: m.id, body: m.body, createdAt: new Date(m.createdAt).getTime(), author: m.author, attachment: m.attachment });
        setLastSendVia("fallback");
        return true;
      } catch {
        return false;
      }
    },
    [caseId, append]
  );

  /** Typing is a live-channel affordance; with polling there is nothing to signal. */
  const notifyTyping = useCallback((_isTyping: boolean) => {
    void _isTyping;
  }, []);

  return {
    messages: caseId ? messages : [],
    historyLoading: caseId ? historyLoading : false,
    connected,
    onlineUsers: caseId ? onlineUsers : [],
    typingUser: caseId ? typingUser : null,
    lastSendVia,
    send,
    notifyTyping,
  };
}
