"use client";
/**
 * Internal staff teams — list, real team chat (polled) and voice notes.
 *
 * Rendered inside the app shell, so this view brings no page chrome of its own:
 * a team list on the left and the selected team's Chat / Members panels on the
 * right. Voice notes stream through the authenticated API client (bearer +
 * same-origin) — never a bare `<audio src>` to the API route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { api, ApiError, type TeamRow, type TeamMessageRow } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n, type StringKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { blobToBase64, transcribeAudio, VoiceNoteRecorder, type VoiceNoteSend } from "@/features/teams/voice-note";
import { Play, Plus, Search, Send, Sparkles, Trash2, Volume2 } from "lucide-react";

type MemberRow = Awaited<ReturnType<typeof api.team>>["members"][number];
type AdminUser = Awaited<ReturnType<typeof api.adminUsers>>["users"][number];

const KIND_LABEL: Record<string, StringKey> = {
  TEAM: "team.kind.TEAM",
  COMMITTEE: "team.kind.COMMITTEE",
  POD: "team.kind.POD",
};

const TEAM_ROLE_LABEL: Record<string, StringKey> = {
  LEADER: "team.leader",
  MEMBER: "team.role.MEMBER",
};

const AUTHOR_ROLE_LABEL: Record<string, StringKey> = {
  CLIENT: "role.CLIENT",
  RM: "role.RM",
  SENIOR_RM: "role.SENIOR_RM",
  ADMIN: "role.ADMIN",
  AUDITOR: "role.AUDITOR",
};

const KINDS = ["TEAM", "COMMITTEE", "POD"] as const;
const STAFF_ROLES = new Set(["RM", "SENIOR_RM", "ADMIN"]);

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

function kindLabel(t: (k: StringKey) => string, kind: string): string {
  return t(KIND_LABEL[kind] ?? "team.kind.TEAM");
}

/* ── view ────────────────────────────────────────────────────── */

export function TeamsView() {
  const { t } = useI18n();
  const session = useApp((s) => s.session);
  const isAdmin = session?.role === "ADMIN";

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.teams();
      setTeams(res.teams);
      setError(null);
      setForbidden(false);
      setSelectedId((prev) =>
        prev && res.teams.some((x) => x.id === prev) ? prev : res.teams[0]?.id ?? null,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // Opening a team marks the read watermark; then refresh the list so the unread
  // pill clears. Both side effects run in promise callbacks.
  useEffect(() => {
    if (!selectedId || forbidden) return;
    let cancelled = false;
    void api
      .teamAction(selectedId, { action: "read" })
      .then(() => {
        if (!cancelled) return load();
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedId, forbidden, load]);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <Card className="rounded-md border-border p-8 text-center">
          <p className="font-editorial text-lg text-cobble-ink">{t("team.title")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("team.noAccess")}</p>
        </Card>
      </div>
    );
  }

  const selected = teams.find((x) => x.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── team list ── */}
        <Card className="min-w-0 gap-0 rounded-md border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-editorial text-lg text-cobble-ink">{t("team.title")}</h2>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5 text-gold-ink" aria-hidden="true" />
                {t("team.newTeam")}
              </Button>
            )}
          </div>

          <div className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
            {loading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-md" />
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="rounded-md border border-coral/50 bg-coral/5 p-4">
                <p className="text-sm text-danger-ink">{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                  {t("common.retry")}
                </Button>
              </div>
            )}

            {!loading && !error && teams.length === 0 && (
              <p className="px-1 py-8 text-center text-sm text-muted-foreground">{t("team.empty")}</p>
            )}

            {!loading &&
              !error &&
              teams.map((team) => {
                const active = team.id === selectedId;
                return (
                  <button
                    key={team.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSelectedId(team.id)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-gold/60 bg-gold/10"
                        : "border-transparent hover:border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-cobble-ink">{team.name}</span>
                          {team.archived && <Badge variant="outline" className="text-[9px]">{t("team.archived")}</Badge>}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>{t("team.memberCount", { n: team.memberCount })}</span>
                          <span aria-hidden="true">·</span>
                          <span>{kindLabel(t, team.kind)}</span>
                          {team.lastMessageAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{relTime(team.lastMessageAt)}</span>
                            </>
                          )}
                        </span>
                      </span>
                      {team.unread > 0 && (
                        <span className="mt-0.5 shrink-0 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-cobble-ink">
                          {t("team.unread", { n: team.unread })}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </Card>

        {/* ── selected team ── */}
        {selectedId ? (
          <TeamPanel
            key={selectedId}
            teamId={selectedId}
            isAdmin={isAdmin}
            fallbackName={selected?.name ?? ""}
            onChanged={load}
          />
        ) : (
          !loading && (
            <Card className="flex items-center justify-center rounded-md border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">{t("team.selectTeam")}</p>
            </Card>
          )
        )}
      </div>

      <NewTeamDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => {
          setSelectedId(id);
          void load();
        }}
      />
    </div>
  );
}

/* ── team panel (chat + members) ─────────────────────────────── */

function TeamPanel({
  teamId,
  isAdmin,
  fallbackName,
  onChanged,
}: {
  teamId: string;
  isAdmin: boolean;
  fallbackName: string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<{ team: TeamRow; members: MemberRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "members">("chat");

  const load = useCallback(async () => {
    try {
      const res = await api.team(teamId);
      setDetail(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  return (
    <Card className="min-w-0 gap-0 rounded-md border-border p-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-editorial text-lg text-cobble-ink">{detail?.team.name ?? fallbackName}</h2>
        {detail?.team.archived && <Badge variant="outline" className="text-[10px]">{t("team.archived")}</Badge>}
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-40 w-full rounded-md" />
        </div>
      ) : error || !detail ? (
        <div className="mt-4 rounded-md border border-coral/50 bg-coral/5 p-4">
          <p className="text-sm text-danger-ink">{error ?? t("common.error")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "chat" | "members")} className="mt-4">
          <TabsList>
            <TabsTrigger value="chat">{t("team.chat")}</TabsTrigger>
            <TabsTrigger value="members">{t("team.members")}</TabsTrigger>
          </TabsList>
          <TabsContent value="chat">
            <TeamChat teamId={teamId} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="members">
            <MembersPanel teamId={teamId} team={detail.team} members={detail.members} isAdmin={isAdmin} onChanged={refresh} />
          </TabsContent>
        </Tabs>
      )}
    </Card>
  );
}

/* ── chat ────────────────────────────────────────────────────── */

function TeamChat({ teamId, onChanged }: { teamId: string; onChanged: () => void }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<TeamMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const afterRef = useRef<string | null>(null);
  const teamIdRef = useRef(teamId);

  const mergeIncoming = useCallback((incoming: TeamMessageRow[]) => {
    if (incoming.length === 0) return;
    const last = incoming[incoming.length - 1].createdAt;
    if (!afterRef.current || last > afterRef.current) afterRef.current = last;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const next = [...prev];
      for (const m of incoming) if (!seen.has(m.id)) next.push(m);
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await api.teamMessages(teamId, afterRef.current ?? undefined);
      // A poll left in flight by the previous team must not merge into this
      // team's list or advance its cursor.
      if (teamIdRef.current !== teamId) return;
      mergeIncoming(res.messages);
      setError(null);
    } catch (e) {
      if (teamIdRef.current !== teamId) return;
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (teamIdRef.current === teamId) setLoading(false);
    }
  }, [teamId, mergeIncoming]);

  // The instance is reused when the selected team changes, so reset the
  // previous team's list + cursor synchronously BEFORE this team's first poll
  // (same commit, declared ahead of the poll effect → runs first).
  useEffect(() => {
    teamIdRef.current = teamId;
    afterRef.current = null;
    setMessages([]);
    setLoading(true);
    setError(null);
  }, [teamId]);

  useEffect(() => {
    void Promise.resolve().then(poll);
    const timer = setInterval(() => void poll(), 4000);
    return () => clearInterval(timer);
  }, [poll]);

  // Scroll to the newest message whenever the list grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function sendText() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await api.sendTeamMessage(teamId, { kind: "TEXT", body: text });
      mergeIncoming([res.message]);
      setBody("");
      onChanged();
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Send failed",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  async function sendAudio(p: VoiceNoteSend) {
    try {
      const res = await api.sendTeamMessage(teamId, {
        kind: "AUDIO",
        audioBase64: p.base64,
        audioMime: p.mime,
        audioDurationMs: p.durationMs,
        transcript: p.transcript ?? undefined,
      });
      mergeIncoming([res.message]);
      onChanged();
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Send failed",
        variant: "destructive",
      });
      throw e;
    }
  }

  function replaceMessage(m: TeamMessageRow) {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => `${m.body} ${m.transcript ?? ""}`.toLowerCase().includes(q));
  }, [messages, query]);

  const groups = useMemo(() => {
    const out: Array<{ day: string; items: TeamMessageRow[] }> = [];
    for (const m of visible) {
      const day = format(new Date(m.createdAt), "dd MMM yyyy");
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [visible]);

  return (
    <div className="mt-3 space-y-3">
      <div className="min-w-0 space-y-3">
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("team.searchMessages")}
            aria-label={t("team.searchMessages")}
            className="rounded-none border-input pl-8 focus-visible:ring-gold"
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">
            <Search className="h-3.5 w-3.5" />
          </span>
        </div>

        <div ref={listRef} className="max-h-[60vh] space-y-4 overflow-y-auto rounded-md border border-border/70 bg-background p-3">
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          )}

          {!loading && error && messages.length === 0 && (
            <div className="p-3 text-center">
              <p className="text-sm text-danger-ink">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void poll()}>
                {t("common.retry")}
              </Button>
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("team.noMessages")}</p>
          )}

          {groups.map((group) => (
            <div key={group.day} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{group.day}</span>
                <span className="h-px flex-1 bg-border/70" />
              </div>
              {group.items.map((m) => (
                <MessageBubble key={m.id} teamId={teamId} message={m} onTranscriptSaved={replaceMessage} />
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendText();
              }
            }}
            placeholder={t("team.messagePlaceholder")}
            aria-label={t("team.messagePlaceholder")}
            disabled={sending}
            className="min-w-0 flex-1 rounded-none border-input focus-visible:ring-gold"
          />
          <Button
            type="button"
            size="icon"
            aria-label={t("team.send")}
            title={t("team.send")}
            disabled={sending || !body.trim()}
            onClick={() => void sendText()}
            className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
          >
            {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </Button>
          <VoiceNoteRecorder onSend={sendAudio} disabled={sending} />
        </div>
      </div>
    </div>
  );
}

/* ── message bubble + audio ──────────────────────────────────── */

function MessageBubble({
  teamId,
  message,
  onTranscriptSaved,
}: {
  teamId: string;
  message: TeamMessageRow;
  onTranscriptSaved: (m: TeamMessageRow) => void;
}) {
  const { t } = useI18n();
  const mine = message.mine;
  const roleLabel = t(AUTHOR_ROLE_LABEL[message.author.role] ?? "role.STAFF");

  return (
    <div className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-[10px] font-semibold text-amber-ink"
          aria-hidden="true"
        >
          {initials(message.author.name)}
        </span>
      )}
      <div className={cn("min-w-0 max-w-[85%]", mine && "items-end")}>
        {!mine && (
          <p className="mb-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {message.author.name} · {roleLabel}
          </p>
        )}
        <div
          className={cn(
            "rounded-md px-3 py-2 text-sm [overflow-wrap:anywhere]",
            mine ? "bg-cobble text-[#F5F1EA]" : "border border-border bg-card text-iron-ink",
          )}
        >
          {message.kind === "AUDIO" ? (
            <AudioMessage teamId={teamId} message={message} onTranscriptSaved={onTranscriptSaved} />
          ) : (
            <p className="whitespace-pre-wrap">{message.body}</p>
          )}
        </div>
        <p className={cn("mt-0.5 text-[10px] text-muted-foreground", mine ? "text-right" : "")}>
          {format(new Date(message.createdAt), "HH:mm")}
        </p>
      </div>
    </div>
  );
}

function AudioMessage({
  teamId,
  message,
  onTranscriptSaved,
}: {
  teamId: string;
  message: TeamMessageRow;
  onTranscriptSaved: (m: TeamMessageRow) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<"unavailable" | "failed" | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function load() {
    if (loading || url) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await api.teamRecordingBlob(teamId, message.id);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const objUrl = URL.createObjectURL(blob);
      urlRef.current = objUrl;
      setUrl(objUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function transcribe() {
    setTranscribing(true);
    setProgress(0);
    setNote(null);
    try {
      const blob = await api.teamRecordingBlob(teamId, message.id);
      const base64 = await blobToBase64(blob);
      const out = await transcribeAudio({ base64, mime: blob.type || "audio/webm" }, (p) => setProgress(p.progress));
      const text = out?.text.trim() ?? "";
      if (!text) {
        setNote("unavailable");
        return;
      }
      const saved = await api.teamAction(teamId, { action: "transcribe", messageId: message.id, transcript: text });
      if (saved.message) onTranscriptSaved(saved.message);
    } catch {
      setNote("failed");
    } finally {
      setTranscribing(false);
      setProgress(null);
    }
  }

  const durationS = Math.round((message.audioDurationMs ?? 0) / 1000);

  return (
    <div className="w-full min-w-[200px] space-y-1.5">
      {url ? (
        <audio controls autoPlay src={url} className="w-full" />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
          aria-label={t("team.voiceNote")}
        >
          {loading ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Play className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}
          {t("team.voiceNote")}
        </Button>
      )}

      <p className={cn("flex items-center gap-1.5 text-[11px]", message.mine ? "text-[#F5F1EA]/70" : "text-muted-foreground")}>
        <Volume2 className="h-3 w-3" aria-hidden="true" />
        {t("team.voiceDuration", { s: durationS })}
      </p>

      {error && <p className="text-[11px] text-danger-ink">{error}</p>}

      {message.transcriptStatus === "READY" && message.transcript && (
        <p className="font-editorial text-[13px] italic leading-relaxed opacity-90">{message.transcript}</p>
      )}

      {message.transcriptStatus === "FAILED" && (
        <p className="text-[11px] text-danger-ink">{t("team.transcriptFailed")}</p>
      )}

      {message.transcriptStatus === "PENDING" && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-amber-ink">{t("team.transcriptPending")}</p>
          {message.mine && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={transcribing}
              onClick={() => void transcribe()}
              className="h-7 px-2 text-xs"
            >
              {transcribing ? <Spinner className="mr-1.5 h-3 w-3" /> : <Sparkles className="mr-1.5 h-3 w-3 text-gold-ink" aria-hidden="true" />}
              {transcribing ? `${t("team.transcribing")} ${progress ?? 0}%` : t("team.transcribe")}
            </Button>
          )}
        </div>
      )}

      {note === "unavailable" && <p className="text-[11px] text-amber-ink">{t("team.sttUnavailable")}</p>}
      {note === "failed" && <p className="text-[11px] text-danger-ink">{t("team.transcriptFailed")}</p>}
    </div>
  );
}

/* ── members ─────────────────────────────────────────────────── */

function MembersPanel({
  teamId,
  team,
  members,
  isAdmin,
  onChanged,
}: {
  teamId: string;
  team: TeamRow;
  members: MemberRow[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: team.name, description: team.description, kind: team.kind });
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void api
      .adminUsers()
      .then((r) => {
        if (!cancelled) setUsers(r.users.filter((u) => u.status === "ACTIVE" && STAFF_ROLES.has(u.role)));
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const refreshAfter = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      try {
        await action();
        toast({ title: label });
        onChanged();
      } catch (e) {
        toast({
          title: t("common.error"),
          description: e instanceof Error ? e.message : "Request failed",
          variant: "destructive",
        });
      }
    },
    [onChanged, t],
  );

  function openEdit() {
    setForm({ name: team.name, description: team.description, kind: team.kind });
    setEditing(true);
  }

  async function saveTeam() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.updateTeam(teamId, {
        name: form.name.trim(),
        description: form.description.trim(),
        kind: form.kind,
      });
      toast({ title: t("team.editTeam") });
      setEditing(false);
      onChanged();
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-4">
      {isAdmin && (
        <div className="rounded-md border border-border/70 bg-muted/30 p-3 space-y-3">
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="team-edit-name">{t("team.name")}</Label>
                <Input
                  id="team-edit-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="rounded-none border-input focus-visible:ring-gold"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-edit-desc">{t("team.description")}</Label>
                <Textarea
                  id="team-edit-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="rounded-none border-input focus-visible:ring-gold"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-edit-kind">{t("team.kind")}</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                  <SelectTrigger id="team-edit-kind" className="w-full" aria-label={t("team.kind")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>{kindLabel(t, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={saving || !form.name.trim()} onClick={() => void saveTeam()}>
                  {saving && <Spinner className="mr-2 h-3.5 w-3.5" />}
                  {t("team.save")}
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
                  {t("team.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={openEdit}>
                  {t("team.editTeam")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5 text-gold-ink" aria-hidden="true" />
                  {t("team.addMember")}
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-iron-ink">
                <Switch
                  checked={team.archived}
                  aria-label={team.archived ? t("team.unarchive") : t("team.archive")}
                  onCheckedChange={(next) =>
                    void refreshAfter(t("team.save"), () => api.updateTeam(teamId, { archived: next }))
                  }
                />
                {team.archived ? t("team.unarchive") : t("team.archive")}
              </label>
            </div>
          )}
        </div>
      )}

      {!isAdmin && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("team.adminOnly")}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-semibold">{t("team.name")}</th>
              <th scope="col" className="py-2 pr-3 font-semibold">{t("team.role")}</th>
              {isAdmin && <th scope="col" className="py-2 text-right font-semibold">{t("team.removeMember")}</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-[10px] font-semibold text-amber-ink"
                      aria-hidden="true"
                    >
                      {initials(m.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-cobble-ink">{m.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{m.email}</span>
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3">
                  {isAdmin ? (
                    <Select
                      value={m.teamRole}
                      onValueChange={(v) =>
                        void refreshAfter(t("team.save"), () =>
                          api.teamAction(teamId, { action: "update-member", userId: m.userId, role: v }),
                        )
                      }
                    >
                      <SelectTrigger size="sm" className="w-32" aria-label={`${t("team.role")} — ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LEADER">{t("team.leader")}</SelectItem>
                        <SelectItem value="MEMBER">{t("team.role.MEMBER")}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {t(TEAM_ROLE_LABEL[m.teamRole] ?? "team.role.MEMBER")}
                    </Badge>
                  )}
                </td>
                {isAdmin && (
                  <td className="py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-danger-ink"
                      aria-label={`${t("team.removeMember")} — ${m.name}`}
                      title={t("team.removeMember")}
                      disabled={busyId === m.userId}
                      onClick={() => setRemoveTarget(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        teamId={teamId}
        users={users}
        existing={members}
        onChanged={onChanged}
      />

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("team.removeMember")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("team.removeConfirm")} <span className="font-medium text-cobble-ink">{removeTarget?.name}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("team.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId === removeTarget?.userId}
              onClick={(e) => {
                e.preventDefault();
                const target = removeTarget;
                if (!target) return;
                setBusyId(target.userId);
                void refreshAfter(t("team.removeMember"), () =>
                  api.teamAction(teamId, { action: "remove-member", userId: target.userId }),
                ).finally(() => {
                  setBusyId(null);
                  setRemoveTarget(null);
                });
              }}
            >
              {t("team.removeMember")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── add member dialog ───────────────────────────────────────── */

function AddMemberDialog({
  open,
  onOpenChange,
  teamId,
  users,
  existing,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teamId: string;
  users: AdminUser[];
  existing: MemberRow[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [busy, setBusy] = useState(false);

  const existingIds = new Set(existing.map((m) => m.userId));
  const available = users.filter((u) => !existingIds.has(u.id));

  async function submit() {
    if (!userId) return;
    setBusy(true);
    try {
      await api.teamAction(teamId, { action: "add-member", userId, role });
      toast({ title: t("team.addMember") });
      setUserId("");
      setRole("MEMBER");
      onOpenChange(false);
      onChanged();
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-editorial text-cobble-ink">{t("team.addMember")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("team.name")}</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full" aria-label={t("team.addMember")}>
                <SelectValue placeholder={t("common.none")} />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("common.none")}</div>
                )}
                {available.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("team.role")}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full" aria-label={t("team.role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LEADER">{t("team.leader")}</SelectItem>
                <SelectItem value="MEMBER">{t("team.role.MEMBER")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("team.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !userId}>
            {busy && <Spinner className="mr-2 h-3.5 w-3.5" />}
            {t("team.addMember")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── new team dialog ─────────────────────────────────────────── */

function NewTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("TEAM");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .adminUsers()
      .then((r) => {
        if (!cancelled) setUsers(r.users.filter((u) => u.status === "ACTIVE" && STAFF_ROLES.has(u.role)));
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await api.createTeam({
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        memberIds: [...selected],
      });
      toast({ title: t("team.newTeam") });
      setName("");
      setDescription("");
      setKind("TEAM");
      setSelected(new Set());
      onOpenChange(false);
      onCreated(res.team.id);
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-editorial text-cobble-ink">{t("team.newTeam")}</DialogTitle>
          <DialogDescription>{t("team.adminOnly")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-team-name">{t("team.name")}</Label>
            <Input
              id="new-team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-none border-input focus-visible:ring-gold"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-team-desc">{t("team.description")}</Label>
            <Textarea
              id="new-team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="rounded-none border-input focus-visible:ring-gold"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-team-kind">{t("team.kind")}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="new-team-kind" className="w-full" aria-label={t("team.kind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{kindLabel(t, k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("team.members")}</Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/70 p-2">
              {users.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">{t("common.none")}</p>}
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/50">
                  <Checkbox
                    checked={selected.has(u.id)}
                    onCheckedChange={() => toggle(u.id)}
                    aria-label={`${u.name} · ${u.email}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-cobble-ink">{u.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{u.email}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("team.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy && <Spinner className="mr-2 h-3.5 w-3.5" />}
            {t("team.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
