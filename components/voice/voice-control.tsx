"use client";
/**
 * Voice control — speak (or type) a command, it is processed LOCALLY, and it is
 * executed only after a human confirms the interpretation.
 *
 * Flow: listen → transcript → local processing (rules → on-device LLM) →
 * HUMAN-IN-THE-LOOP confirmation → execute. Nothing runs without the confirm.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Mic, MicOff, Sparkles, Wand2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useSpeechToText } from "@/hooks/use-speech-to-text";
import { processVoiceTranscript } from "@/lib/ai/voice";
import { disclosureLines } from "@/lib/ai/disclosure";
import type { VoiceIntent } from "@/lib/ai/voice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Processed = {
  label: string;
  intent: VoiceIntent;
  source: "rules" | "local-llm";
  tier: string;
  confidence: number;
};

export function VoiceControl({
  open,
  onOpenChange,
  onExecute,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onExecute: (intent: VoiceIntent) => void;
}) {
  const { t, locale } = useI18n();
  const stt = useSpeechToText(locale);
  // Rendered shell-mounted with an `open` prop — closing must release the mic.
  useEffect(() => {
    if (!open) stt.stop();
  }, [open, stt.stop]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [processed, setProcessed] = useState<Processed | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const transcript = stt.transcript || text;

  const interpret = useCallback(async () => {
    const input = (stt.transcript || text).trim();
    if (!input) return;
    setBusy(true);
    try {
      const res = await processVoiceTranscript(input);
      setProcessed({
        label: res.command.intent.label,
        intent: res.command.intent,
        source: res.source,
        tier: res.tier,
        confidence: res.command.confidence,
      });
    } finally {
      setBusy(false);
    }
  }, [stt.transcript, text]);

  // HUMAN-IN-THE-LOOP — the single point where a voice command is applied.
  const confirm = useCallback(() => {
    if (!processed || processed.intent.kind === "unknown") return;
    onExecute(processed.intent);
    setLog((l) =>
      [`${processed.label} · ${processed.source}`, ...l].slice(0, 6)
    );
    setProcessed(null);
    stt.reset();
    setText("");
  }, [processed, onExecute, stt]);

  const cancel = useCallback(() => {
    setProcessed(null);
    stt.reset();
    setText("");
  }, [stt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-editorial text-cobble-ink">
            <Mic className="h-5 w-5 text-gold-ink" aria-hidden />{" "}
            {t("voice.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("voice.subtitle")}
          </DialogDescription>
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Mic className="h-3 w-3 text-gold-ink" aria-hidden />
            On-device — audio never leaves this browser (E17).
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mic + live transcript */}
          <div className="rounded-md border border-border/70 bg-muted/20 p-3.5">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={() => (stt.listening ? stt.stop() : void stt.start())}
                disabled={!stt.supported || busy}
                className={cn(
                  "h-11 w-11 rounded-full p-0",
                  stt.listening
                    ? "bg-[#b04a48] text-white"
                    : "bg-cobble text-gold-ink"
                )}
                aria-label={stt.listening ? t("voice.stop") : t("voice.start")}
              >
                {stt.listening ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {stt.listening ? t("voice.listening") : t("voice.start")} ·{" "}
                  {stt.engine === "none" ? t("voice.unsupported") : stt.engine}
                </p>
                <p className="mt-0.5 min-h-5 truncate text-sm text-cobble-ink">
                  {transcript || t("voice.placeholder")}
                </p>
              </div>
            </div>
            {/* Text fallback — voice control works even without a mic */}
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void interpret();
                }}
                placeholder={t("voice.typePlaceholder")}
                aria-label={t("voice.typePlaceholder")}
              />
              <Button
                variant="outline"
                onClick={() => void interpret()}
                disabled={busy || !transcript.trim()}
              >
                <Wand2 className="h-4 w-4" /> {t("voice.interpret")}
              </Button>
            </div>
          </div>

          {/* Interpreted command + HITL confirm */}
          {processed && (
            <div className="rounded-md border border-gold/40 bg-gold/5 p-3.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("voice.interpreted")}
              </p>
              <p className="mt-1 text-sm font-medium text-cobble-ink">
                {processed.label}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {processed.source === "local-llm"
                  ? t("voice.source.local")
                  : t("voice.source.rules")}{" "}
                · {processed.tier} · {Math.round(processed.confidence * 100)}%
              </p>
              {processed.intent.kind === "unknown" ? (
                <p className="mt-2 text-xs text-danger-ink">
                  {t("voice.unknown")}
                </p>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    onClick={confirm}
                    className="bg-cobble text-[#F5F1EA] hover:bg-cobble/90"
                  >
                    <Check className="h-4 w-4" /> {t("voice.confirm")}
                  </Button>
                  <Button variant="ghost" onClick={cancel}>
                    <X className="h-4 w-4" /> {t("voice.cancel")}
                  </Button>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-gold-ink">
                    {t("voice.hitl")}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* AI disclosure — auto-rendered, same source as every surface */}
          <details className="rounded-md border border-border/60 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
              {t("voice.howItWorks")}
            </summary>
            <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
              {disclosureLines("voice-command").map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>

          {/* Session log — every executed command, in order */}
          {log.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-gold-ink" aria-hidden />{" "}
                {t("voice.log")}
              </p>
              <ul className="space-y-1 text-xs text-iron-ink">
                {log.map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
