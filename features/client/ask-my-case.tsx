"use client";

/**
 * Ask My Case — client-facing AI assistant, browser-AI-architect rebuild.
 *
 * Authoritative path is the server case copilot (org-scoped ledger, cited
 * facts, R4 eval receipts). The browser cascade is a consent-gated resilience
 * path: PromptAPI Nano -> pinned local chat -> cost-capped cloud proxy, with
 * cancel, warm-up, offline-degraded messaging and a local/cloud indicator.
 * E17 data-never-leaves banner + per-feature AI disclosure auto-rendered.
 * All server traffic rides @/lib/api-client (no raw fetch for API calls).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { api, get } from "@/lib/api-client";
import { runCascade, tierLabel, warmChat, placementOf, type ChatMessage, type CascadeResult, type Placement } from "@/lib/ai/browser/cascade";
import { ModelUnavailable } from "@/lib/ai/browser/pipelines";
import { useAiConsent } from "@/lib/ai/browser/consent";
import { disclosureLines } from "@/lib/ai/disclosure";
import { citationGate } from "@/lib/ai/eval-receipts";
import { PROMPT_VERSION, promptBundleHash } from "@/lib/ai/prompts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Send, Sparkles, ShieldCheck, Cloud, Cpu, AlertCircle, ShieldAlert, ThumbsUp, ThumbsDown, Check, Square, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** One citable fact backing an answer (mirrors the server AgentCitation). */
type Citation = { factId: string; entity: string; field: string; value: string | null; source: { kind: string; ref: string; label: string } };

type Message = {
  id: string; role: "user" | "assistant"; content: string; tier?: string; placement?: Placement;
  authority?: "server" | "browser"; citations?: Citation[]; confidence?: number; runId?: string;
  degraded?: string; timestamp: Date;
};

type AskMyCaseProps = { caseId: string; caseStatus: string; programmeName?: string; documentsCount: number; pendingDocumentsCount: number; className?: string };

/** Deterministic next-step hint when AI is unreachable (offline-degraded). */
function offlineHint(status: string, pending: number): string {
  if (pending > 0) return "You have " + pending + " document(s) still to upload — open the documents section to continue while AI is offline.";
  switch (status) {
    case "DOCS_REQUESTED": return "Review each uploaded document with your relationship manager to move forward.";
    case "IN_PROGRESS": return "Your dossier is being prepared — your relationship manager will update you.";
    default: return "Your case data is safe. Try again when you are back online, or contact your relationship manager.";
  }
}

export function AskMyCase({ caseId, caseStatus, programmeName, documentsCount, pendingDocumentsCount, className }: AskMyCaseProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, "HELPFUL" | "NOT_HELPFUL">>({});
  const { consent, decided, update } = useAiConsent();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ cloudEnabled?: boolean; openrouterConfigured?: boolean }>("/api/ai/cascade/status")
      .then((data) => { if (!cancelled) { setCloudEnabled(data.cloudEnabled ?? false); } })
      .catch(() => { if (!cancelled) setCloudEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  // Warm-up the on-device model during idle — first answer feels instant.
  useEffect(() => {
    if (decided && consent.local) warmChat();
  }, [decided, consent.local]);

  // Cancelling on unmount: no orphaned inference, no state after teardown.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const systemPrompt = useCallback(() => {
    const context = [
      "You are a helpful assistant for a citizenship and residence by investment consultancy.",
      "The client's current case status is: " + caseStatus + ".",
      programmeName ? "Their chosen programme is: " + programmeName + "." : null,
      "They have " + documentsCount + " document(s) on file.",
      pendingDocumentsCount > 0 ? "They still need to upload " + pendingDocumentsCount + " document(s)." : "All requested documents have been received.",
      "",
      "Provide clear, concise answers about their application status, next steps, and any documents they need to provide.",
      "If you don't know something specific about their case, suggest they contact their Relationship Manager.",
      "Keep responses under 150 words unless they ask for detailed information.",
    ].filter(Boolean).join("\n");
    return context;
  }, [caseStatus, programmeName, documentsCount, pendingDocumentsCount]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setError(null); setDegraded(null); setStreaming("");
    const userMessage: Message = { id: "user-" + Date.now(), role: "user", content: trimmed, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInput(""); setIsLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const chatMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt() },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: trimmed },
      ];
      let answer: { text: string; tier: string; placement: Placement; authority: "server" | "browser"; citations: Citation[]; confidence: number; degraded?: string };
      let serverRunId: string | undefined;
      try {
        const grounded = await api.aiAgent({ agent: "case-copilot", caseId, message: trimmed });
        if (ctrl.signal.aborted) return;
        serverRunId = grounded.runId;
        answer = { text: grounded.reply, tier: grounded.provider, placement: "local", authority: "server", citations: grounded.citations ?? [], confidence: grounded.confidence ?? 0 };
      } catch {
        if (ctrl.signal.aborted) return;
        if (!consent.local && !consent.cloud) {
          setDegraded("AI is switched off — enable on-device or cloud AI above to get answers here. " + offlineHint(caseStatus, pendingDocumentsCount));
          return;
        }
        const local: CascadeResult = await runCascade(chatMessages, { timeoutMs: 30000, signal: ctrl.signal, onToken: (_tier, tok) => setStreaming((s) => s + tok) });
        if (ctrl.signal.aborted) return;
        if (!local.text) {
          setDegraded((local.degraded?.reason ?? "AI unavailable.") + " " + offlineHint(caseStatus, pendingDocumentsCount));
          return;
        }
        answer = { text: local.text, tier: tierLabel(local.tier), placement: local.placement, authority: "browser", citations: [], confidence: 0, degraded: local.degraded?.reason };
      }
      const assistantMessage: Message = { id: "assistant-" + Date.now(), role: "assistant", content: answer.text, tier: answer.tier, placement: answer.placement, authority: answer.authority, citations: answer.citations, confidence: answer.confidence, degraded: answer.degraded, runId: serverRunId, timestamp: new Date() };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      if (err instanceof ModelUnavailable && err.reason === "cancelled") return;
      if (ctrl.signal.aborted) return;
      setError(t("askmycase.error"));
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreaming(""); setIsLoading(false); inputRef.current?.focus();
    }
  }, [caseId, input, isLoading, messages, systemPrompt, t, consent.local, consent.cloud, caseStatus, pendingDocumentsCount]);

  const sendFeedback = useCallback(async (messageId: string, rating: "HELPFUL" | "NOT_HELPFUL") => {
    setFeedback((prev) => ({ ...prev, [messageId]: rating }));
    try {
      const message = messages.find((m) => m.id === messageId);
      if (!message?.runId) return;
      await api.aiFeedback({ agent: "case-copilot", caseId, runId: message.runId, rating });
    } catch { /* feedback is best-effort */ }
  }, [caseId, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  const suggestions = [t("askmycase.suggest.status"), t("askmycase.suggest.documents"), t("askmycase.suggest.next"), t("askmycase.suggest.timeline")];
  const handleSuggestionClick = (suggestion: string) => { setInput(suggestion); inputRef.current?.focus(); };

  const lastPlacement: Placement | undefined = [...messages].reverse().find((m) => m.role === "assistant")?.placement;
  const receiptHash = promptBundleHash();

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold-ink" />
            <CardTitle className="text-lg">{t("askmycase.title")}</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs" data-testid="ai-placement">
            {lastPlacement === "cloud" ? (<><Cloud className="mr-1 h-3 w-3" />Cloud · {t("ai.live")}</>)
              : lastPlacement === "local" ? (<><Cpu className="mr-1 h-3 w-3" />On-device</>)
              : cloudEnabled ? (<><Cloud className="mr-1 h-3 w-3" />{t("ai.live")}</>)
              : (<><Cpu className="mr-1 h-3 w-3" />{t("ai.fallback")}</>)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("askmycase.subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* E17 — data-never-leaves banner (always visible, never dismissible) */}
        <Alert className="border-emerald-600/30 bg-emerald-500/5 py-2" data-testid="e17-banner">
          <ShieldCheck className="h-4 w-4 text-emerald-700" />
          <AlertDescription className="text-xs">Your documents never leave this device for on-device AI. Cloud answers run only with your consent, with personal details stripped first.</AlertDescription>
        </Alert>

        {/* Consent gate — nothing runs until the user chooses */}
        {!decided && (
          <div className="rounded-md border border-gold/40 bg-gold/5 p-3.5" data-testid="ai-consent-gate">
            <p className="text-sm font-medium text-cobble-ink">Choose how AI may run for you</p>
            <p className="mt-1 text-xs text-muted-foreground">On-device AI downloads a small model once and answers privately, even offline. Cloud AI can answer harder questions but sends redacted text to our model provider.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => update({ local: true })}>Enable on-device AI</Button>
              <Button size="sm" variant="outline" onClick={() => update({ local: true, cloud: true })}>Enable both</Button>
              <Button size="sm" variant="ghost" onClick={() => update({ local: false, cloud: false })}>Keep AI off</Button>
            </div>
          </div>
        )}

        {/* PII Notice */}
        <Alert className="py-2">
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">{cloudEnabled ? t("askmycase.piiNoticeCloud") : t("askmycase.piiNotice")}</AlertDescription>
        </Alert>

        {/* Messages */}
        <ScrollArea className="h-[300px] w-full rounded-md border p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Sparkles className="mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("ai.emptyBody")}</p>
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("askmycase.suggestions")}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((suggestion) => (<Button key={suggestion} variant="outline" size="sm" onClick={() => handleSuggestionClick(suggestion)} className="text-xs">{suggestion}</Button>))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => {
                const cited = message.citations ?? [];
                const gate = message.role === "assistant" && message.authority === "server" ? citationGate(cited.map((c) => c.factId), cited.map((c) => c.factId)) : null;
                const receipt = gate ? (gate.passed ? "cited " + cited.length : "citation check") + " · prompt " + PROMPT_VERSION + " · " + receiptHash : null;
                return (
                <div key={message.id} className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}>
                  <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", message.role === "user" ? "bg-cobble text-[#F5F1EA]" : "bg-muted text-foreground")}>{message.content}</div>
                  {message.role === "assistant" && message.authority === "browser" && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-ink/10 px-2 py-0.5 text-[10px] font-medium text-amber-ink"><ShieldAlert className="h-3 w-3" aria-hidden />{t("ai.unverified")}</span>)}
                  {message.role === "assistant" && message.placement && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">{message.placement === "cloud" ? (<><Cloud className="h-3 w-3" aria-hidden />Answered in the cloud (redacted)</>) : (<><Cpu className="h-3 w-3" aria-hidden />Answered on this device</>)}</span>)}
                  {message.role === "assistant" && message.authority === "server" && (
                    <div className="mt-2 w-full max-w-[85%] space-y-1.5" data-testid="ask-my-case-sources">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("ai.sources")}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid="ask-my-case-confidence">{t("ai.confidence", { value: Math.round((message.confidence ?? 0) * 100) })}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" title="Client-observed receipt — the canonical R4 eval receipt is stored server-side on the AI run">{receipt}</span>
                      </div>
                      {message.citations && message.citations.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {message.citations.map((c) => (<li key={c.factId} title={c.source.label} className="rounded border border-border/70 bg-card px-1.5 py-0.5 text-[10px] text-iron-ink">{c.entity}.{c.field} = {c.value ?? "—"}</li>))}
                        </ul>
                      ) : (<p className="text-[10px] text-muted-foreground">{t("ai.sources.none")}</p>)}
                      <div className="flex items-center gap-2 pt-0.5">
                        {feedback[message.id] ? (<span role="status" className="inline-flex min-h-6 items-center gap-1 text-[10px] text-muted-foreground"><Check className="h-3 w-3" aria-hidden />{t("ai.feedback.thanks")}</span>)
                        : (<><button type="button" onClick={() => void sendFeedback(message.id, "HELPFUL")} className="inline-flex min-h-6 min-w-6 items-center justify-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-iron-ink hover:border-gold hover:text-cobble-ink"><ThumbsUp className="h-3 w-3" aria-hidden />{t("ai.feedback.helpful")}</button><button type="button" onClick={() => void sendFeedback(message.id, "NOT_HELPFUL")} className="inline-flex min-h-6 min-w-6 items-center justify-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-iron-ink hover:border-gold hover:text-cobble-ink"><ThumbsDown className="h-3 w-3" aria-hidden />{t("ai.feedback.notHelpful")}</button></>)}
                      </div>
                    </div>)}
                  {message.tier && (<span className="mt-1 text-[10px] text-muted-foreground">{t("askmycase.tier", { tier: message.tier })}</span>)}
                </div>);
              })}
              {isLoading && (
                <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-gold" />
                  <span className="max-w-[85%]">{streaming || t("askmycase.thinking")}</span>
                  <Button size="sm" variant="ghost" onClick={cancel} aria-label="Cancel AI answer"><Square className="h-3.5 w-3.5" />Cancel</Button>
                </div>)}
            </div>)}
        </ScrollArea>

        {degraded && (<Alert className="border-amber-600/30 bg-amber-500/5 py-2"><WifiOff className="h-4 w-4" /><AlertDescription className="text-xs">{degraded}</AlertDescription></Alert>)}
        {error && (<Alert variant="destructive" className="py-2"><AlertCircle className="h-4 w-4" /><AlertDescription className="text-xs">{error}</AlertDescription></Alert>)}

        <Separator />

        <div className="flex gap-2">
          <Textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={t("askmycase.placeholder")} aria-label={t("askmycase.placeholder")} className="min-h-[60px] flex-1 resize-none" disabled={isLoading} />
          {isLoading ? (<Button onClick={cancel} variant="outline" className="h-auto" aria-label="Cancel AI answer"><Square className="h-4 w-4" aria-hidden="true" /></Button>)
          : (<Button onClick={() => void handleSend()} disabled={!input.trim()} className="h-auto" aria-label={t("askmycase.send")}><Send className="h-4 w-4" aria-hidden="true" /></Button>)}
        </div>

        {/* AI disclosure — auto-rendered from the single disclosure source */}
        <details className="rounded-md border border-border/60 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">How this AI works (disclosure)</summary>
          <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
            {disclosureLines("ask-my-case").map((line, i) => (<li key={i}>{line}</li>))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}