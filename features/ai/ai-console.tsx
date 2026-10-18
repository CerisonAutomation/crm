"use client";
/**
 * AI console — one dialog with two grounded surfaces:
 *  · Assistant — chat with a context-aware agent (platform Q&A, or a case copilot
 *    when a case is in focus). Threads persist per organisation.
 *  · Research — auto-research over live operational data: ranked gaps + a summary.
 *
 * The provider label is always shown so a live model is never confused with the
 * deterministic fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { prepareUpload } from "@/lib/upload-image";
import { CallLauncher } from "@/features/calls/call-launcher";

/** One citable fact backing an answer (mirrors the server's AgentCitation). */
type Citation = {
  factId: string;
  entity: string;
  field: string;
  value: string | null;
  source: { kind: string; ref: string; label: string };
};
type Msg = {
  role: "user" | "assistant";
  content: string;
  /** "server" = authoritative, grounded in the case record; "browser" = on-device fallback. */
  authority?: "server" | "browser";
  citations?: Citation[];
  confidence?: number;
  runId?: string;
};
type Insight = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  action?: string;
  count: number;
};

const SEVERITY: Record<string, { icon: typeof Info; tone: string }> = {
  critical: { icon: ShieldAlert, tone: "text-danger-ink" },
  warn: { icon: AlertTriangle, tone: "text-amber-ink" },
  info: { icon: Info, tone: "text-iron-ink" },
};

const TABS = ["assistant", "messenger", "research"] as const;
type AiTab = (typeof TABS)[number];

export function AiConsole({
  open,
  onOpenChange,
  caseId,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseId?: string | null;
  initialTab?: "assistant" | "research";
}) {
  const { t } = useI18n();
  const role = useApp((s) => s.session?.role);
  const [tab, setTab] = useState<AiTab>(initialTab ?? "assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  /** Per-message rating (keyed by message index), so a rated answer shows its acknowledgement. */
  const [feedback, setFeedback] = useState<
    Record<number, "HELPFUL" | "NOT_HELPFUL">
  >({});
  const [clientCaseId, setClientCaseId] = useState<string | null>(null);
  const [research, setResearch] = useState<{
    summary: string;
    insights: Insight[];
    provider: string;
  } | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  // Opt-in on-device rewrite of the deterministic brief (style only, facts
  // unchanged). Local tiers only - the cloud path is never touched here.
  const [rewrite, setRewrite] = useState<string | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteNote, setRewriteNote] = useState<string | null>(null);
  const rewriteCtrl = useRef<AbortController | null>(null);
  const [messengerBody, setMessengerBody] = useState("");
  const [messengerFile, setMessengerFile] = useState<File | null>(null);
  const [messengerBusy, setMessengerBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /** WAI-ARIA tabs keyboard model: ←/→ to move, Home/End to jump. */
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next]);
    tabRefs.current[next]?.focus();
  };

  // A CLIENT can only use the case copilot on their own case — resolve it.
  useEffect(() => {
    if (open && role === "CLIENT" && !clientCaseId) {
      api
        .myCase()
        .then((r) => setClientCaseId(r.case?.id ?? null))
        .catch(() => undefined);
    }
  }, [open, role, clientCaseId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cancelling on unmount: no orphaned local inference, no state after teardown.
  useEffect(
    () => () => {
      try {
        rewriteCtrl.current?.abort();
      } catch {
        /* abort never throws */
      }
    },
    []
  );

  // Voice control can request a specific tab (e.g. "run research").
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  const effectiveCaseId = caseId ?? clientCaseId ?? undefined;

  const sendMessenger = useCallback(async () => {
    if (!effectiveCaseId || !messengerBody.trim() || messengerBusy) return;
    if (
      !window.confirm(
        "Send this message to the case participant?\n\nChoose Cancel to do something else."
      )
    )
      return;
    setMessengerBusy(true);
    try {
      let documentId: string | undefined;
      if (messengerFile) {
        const prepared = await prepareUpload(messengerFile);
        const uploaded = await api.uploadDocument({
          type: "OTHER",
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          dataBase64: prepared.dataBase64,
          caseId: effectiveCaseId,
        });
        documentId = uploaded.document.id;
      }
      const sent = await api.sendMessage(
        effectiveCaseId,
        messengerBody.trim(),
        documentId
      );
      setMessengerBody("");
      setMessengerFile(null);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Message sent${
            sent.message.attachment
              ? ` with ${sent.message.attachment.fileName}`
              : ""
          }.`,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: e instanceof Error ? e.message : "Message failed to send.",
        },
      ]);
    } finally {
      setMessengerBusy(false);
    }
  }, [effectiveCaseId, messengerBody, messengerFile, messengerBusy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    try {
      const res = await api.aiAgent({
        agent: effectiveCaseId ? "case-copilot" : "assistant",
        message: text,
        caseId: effectiveCaseId,
        threadId: threadId ?? undefined,
      });
      setThreadId(res.threadId);
      setProvider(res.provider);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.reply,
          authority: "server",
          citations: res.citations ?? [],
          confidence: res.confidence ?? 0,
          runId: res.runId,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: e instanceof Error ? e.message : t("ai.error"),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, effectiveCaseId, threadId, t]);

  /**
   * Record a human rating of an answer. Best-effort: the rating is shown
   * immediately and a failed write never breaks the conversation.
   */
  const sendFeedback = useCallback(
    async (index: number, rating: "HELPFUL" | "NOT_HELPFUL") => {
      setFeedback((prev) => ({ ...prev, [index]: rating }));
      try {
        const runId = messages[index]?.runId;
        if (!runId) return;
        await api.aiFeedback({
          agent: effectiveCaseId ? "case-copilot" : "assistant",
          caseId: effectiveCaseId,
          runId,
          rating,
        });
      } catch {
        /* feedback is best-effort */
      }
    },
    [effectiveCaseId, messages]
  );

  const runResearch = useCallback(async () => {
    setResearchBusy(true);
    // A fresh brief invalidates any previous on-device rewrite.
    setRewrite(null);
    setRewriteNote(null);
    try {
      const res = await api.aiResearch();
      setResearch({
        summary: res.summary,
        insights: res.insights,
        provider: res.provider,
      });
    } catch (e) {
      setResearch({
        summary: e instanceof Error ? e.message : t("ai.error"),
        insights: [],
        provider: "error",
      });
    } finally {
      setResearchBusy(false);
    }
  }, [t]);

  /**
   * Opt-in on-device rewrite of the deterministic brief. Local tiers only
   * (PromptAPI Nano, then the pinned local chat) - generateWithOpenRouter and
   * runCascade are deliberately NOT called here, so the cloud path stays
   * untouched: no consent prompt for cloud, no PII-strip, no server call.
   * The server brief above remains the authoritative digest either way.
   */
  const runLocalRewrite = useCallback(async () => {
    if (!research || rewriteBusy) return;
    setRewriteBusy(true);
    setRewriteNote(null);
    try {
      rewriteCtrl.current?.abort();
    } catch {
      /* best-effort */
    }
    const ctrl = new AbortController();
    rewriteCtrl.current = ctrl;
    try {
      const consentMod = await import("@/lib/ai/browser/consent");
      if (!consentMod.getAiConsent().local) {
        setRewriteNote(
          "On-device AI is off, so nothing ran and nothing was sent anywhere. Turn on local AI in Settings to enable the on-device rewrite."
        );
        return;
      }
      const cascade = await import("@/lib/ai/browser/cascade");
      const messages: Parameters<typeof cascade.generateWithWindowAi>[0] = [
        {
          role: "system",
          content:
            "Rewrite the operations brief below in plain, concise language for a busy manager. Restyle only: do not add facts, numbers, names or recommendations that are not already in the brief.",
        },
        { role: "user", content: research.summary.slice(0, 4000) },
      ];
      const nano = await cascade.generateWithWindowAi(messages, {
        signal: ctrl.signal,
      });
      let text = nano;
      let tier: string | null = nano ? "window-ai" : null;
      if (!text) {
        const local = await cascade.generateWithWebLLM(messages, {
          signal: ctrl.signal,
        });
        text = local ? local.text : null;
        tier = local ? "webllm" : null;
      }
      if (ctrl.signal.aborted) return;
      if (!text) {
        setRewriteNote(
          "The on-device model is not available on this device yet - the authoritative brief above is unchanged."
        );
        return;
      }
      setRewrite(text);
      setRewriteNote(
        tier === "window-ai"
          ? "On-device rewrite (Chrome AI, this device only) - style only, facts unchanged. The brief above stays authoritative."
          : "On-device rewrite (local model, this device only) - style only, facts unchanged. The brief above stays authoritative."
      );
    } catch {
      if (ctrl.signal.aborted) setRewriteNote("Rewrite cancelled.");
      else
        setRewriteNote(
          "The on-device rewrite failed - the authoritative brief above is unchanged."
        );
    } finally {
      if (rewriteCtrl.current === ctrl) rewriteCtrl.current = null;
      setRewriteBusy(false);
    }
  }, [research, rewriteBusy]);

  const providerLabel =
    provider === "deterministic-fallback"
      ? t("ai.fallback")
      : provider
      ? t("ai.live")
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[720px] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 font-editorial text-cobble-ink">
            <Sparkles className="h-5 w-5 text-gold-ink" aria-hidden />{" "}
            {t("ai.title")}
            {providerLabel && (
              <span
                className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                  provider === "deterministic-fallback"
                    ? "bg-muted text-muted-foreground"
                    : "bg-gold/15 text-gold-ink"
                )}
              >
                {providerLabel}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {effectiveCaseId ? t("ai.subtitle.case") : t("ai.subtitle")}
          </DialogDescription>
          <div
            className="mt-3 flex gap-1"
            role="tablist"
            aria-label={t("ai.title")}
            onKeyDown={onTabKey}
          >
            {TABS.map((id, i) => (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`ai-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls={`ai-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                  tab === id
                    ? "bg-cobble text-[#F5F1EA]"
                    : "text-iron-ink hover:bg-muted"
                )}
              >
                {id === "assistant" ? (
                  <Bot className="h-3.5 w-3.5" />
                ) : id === "messenger" ? (
                  <Send className="h-3.5 w-3.5" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                {id === "assistant"
                  ? t("ai.tab.assistant")
                  : id === "messenger"
                  ? "Messenger"
                  : t("ai.tab.research")}
              </button>
            ))}
          </div>
        </DialogHeader>

        {tab === "assistant" ? (
          <>
            <div
              role="tabpanel"
              id="ai-panel-assistant"
              aria-labelledby="ai-tab-assistant"
              className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
            >
              {messages.length === 0 && (
                <div className="rounded-md border border-dashed border-limestone bg-card/60 p-4 text-sm text-iron-ink">
                  <p className="font-medium text-cobble-ink">
                    {t("ai.emptyTitle")}
                  </p>
                  <p className="mt-1">{t("ai.emptyBody")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      t("ai.suggest.1"),
                      t("ai.suggest.2"),
                      t("ai.suggest.3"),
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="rounded-full border border-limestone px-3 py-1 text-xs text-iron-ink hover:border-gold hover:text-cobble-ink"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col",
                    m.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-sm",
                      m.role === "user"
                        ? "bg-cobble text-[#F5F1EA]"
                        : "border border-border/70 bg-muted/30 text-foreground"
                    )}
                  >
                    {m.content}
                  </div>
                  {m.role === "assistant" && m.authority === "browser" && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-ink/10 px-2 py-0.5 text-[10px] font-medium text-amber-ink">
                      <ShieldAlert className="h-3 w-3" aria-hidden />
                      {t("ai.unverified")}
                    </span>
                  )}
                  {m.role === "assistant" && m.authority === "server" && (
                    <div
                      className="mt-2 w-full max-w-[85%] space-y-1.5"
                      data-testid="ai-console-sources"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {t("ai.sources")}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t("ai.confidence", {
                            value: Math.round((m.confidence ?? 0) * 100),
                          })}
                        </span>
                      </div>
                      {m.citations && m.citations.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {m.citations.map((c) => (
                            <li
                              key={c.factId}
                              title={c.source.label}
                              className="rounded border border-border/70 bg-card px-1.5 py-0.5 text-[10px] text-iron-ink"
                            >
                              {c.entity}.{c.field} = {c.value ?? "—"}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          {t("ai.sources.none")}
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-0.5">
                        {feedback[i] ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Check className="h-3 w-3" aria-hidden />
                            {t("ai.feedback.thanks")}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void sendFeedback(i, "HELPFUL")}
                              className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-iron-ink hover:border-gold hover:text-cobble-ink"
                            >
                              <ThumbsUp className="h-3 w-3" aria-hidden />
                              {t("ai.feedback.helpful")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void sendFeedback(i, "NOT_HELPFUL")
                              }
                              className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-iron-ink hover:border-gold hover:text-cobble-ink"
                            >
                              <ThumbsDown className="h-3 w-3" aria-hidden />
                              {t("ai.feedback.notHelpful")}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{" "}
                  {t("ai.thinking")}
                </div>
              )}
              <div ref={endRef} />
            </div>
            <div className="border-t border-border/70 p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder={t("ai.placeholder")}
                  aria-label={t("ai.placeholder")}
                  className="min-h-11 resize-none"
                />
                <Button
                  onClick={() => void send()}
                  disabled={busy || !input.trim()}
                  className="min-h-11 bg-cobble text-[#F5F1EA] hover:bg-cobble/90"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : tab === "messenger" ? (
          <div
            role="tabpanel"
            id="ai-panel-messenger"
            aria-labelledby="ai-tab-messenger"
            className="flex-1 overflow-y-auto px-5 py-4"
          >
            <div className="rounded-md border border-gold/30 bg-gold/5 p-4">
              <p className="font-medium text-cobble-ink">Case Messenger</p>
              <p className="mt-1 text-sm text-iron-ink">
                Prepare a message, attach a document, or call the participant.
                Nothing is sent without confirmation.
              </p>
            </div>
            {!effectiveCaseId ? (
              <p className="mt-5 rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
                Open an assigned case to use messaging, uploads, and calls.
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                <Textarea
                  value={messengerBody}
                  onChange={(e) => setMessengerBody(e.target.value)}
                  rows={5}
                  placeholder="Write a custom message…"
                  aria-label="Custom case message"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="ai-messenger-file"
                    type="file"
                    className="sr-only"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    onChange={(e) =>
                      setMessengerFile(e.target.files?.[0] ?? null)
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      document.getElementById("ai-messenger-file")?.click()
                    }
                    disabled={messengerBusy}
                  >
                    Attach file
                  </Button>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {messengerFile?.name ?? "No attachment selected"}
                  </span>
                  <CallLauncher
                    caseId={effectiveCaseId}
                    mySide={role === "CLIENT" ? "CLIENT" : "STAFF"}
                  />
                  <Button
                    type="button"
                    onClick={() => void sendMessenger()}
                    disabled={messengerBusy || !messengerBody.trim()}
                  >
                    {messengerBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}{" "}
                    Send
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            role="tabpanel"
            id="ai-panel-research"
            aria-labelledby="ai-tab-research"
            className="flex-1 overflow-y-auto px-5 py-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-iron-ink">{t("ai.research.intro")}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runResearch()}
                disabled={researchBusy}
              >
                {researchBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("ai.research.run")}
              </Button>
            </div>
            {research && (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-gold/30 bg-gold/5 p-3.5 text-sm text-foreground whitespace-pre-wrap">
                  {research.summary}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runLocalRewrite()}
                    disabled={rewriteBusy}
                    data-testid="research-local-rewrite"
                  >
                    {rewriteBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Rewrite on-device (opt-in)
                  </Button>
                  {rewriteNote && (
                    <p className="text-xs text-muted-foreground">
                      {rewriteNote}
                    </p>
                  )}
                </div>
                {rewrite && (
                  <div
                    className="rounded-md border border-border/70 bg-card p-3.5 text-sm text-foreground whitespace-pre-wrap"
                    data-testid="research-local-rewrite-result"
                  >
                    {rewrite}
                  </div>
                )}
                {research.insights.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("ai.research.none")}
                  </p>
                )}
                {research.insights.map((ins) => {
                  const s = SEVERITY[ins.severity] ?? SEVERITY.info;
                  const Icon = s.icon;
                  return (
                    <div
                      key={ins.id}
                      className="rounded-md border border-border/70 bg-card p-3.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <Icon
                          className={cn("mt-0.5 h-4 w-4 shrink-0", s.tone)}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-cobble-ink">
                            {ins.title}
                          </p>
                          {ins.detail && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {ins.detail}
                            </p>
                          )}
                          {ins.action && (
                            <p className="mt-1 text-xs text-gold-ink">
                              {ins.action}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
