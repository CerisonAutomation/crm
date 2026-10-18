"use client";
/**
 * PushToTalk — hold the mic (or the ` key) and speak; release and it runs.
 *
 * This is the instant path into the voice grammar: the transcript is decoded on
 * the device as you speak (Web Speech interim results), parsed by the rules
 * engine the moment you let go, and the resulting intent is executed
 * immediately. Only destructive intents (sign-out) stop for a one-tap confirm.
 *
 * Everything the command can drive — navigation, the command palette,
 * notifications, help, the AI console, research, search, theme, language,
 * scrolling, history, closing overlays — is executed by the shell, which owns
 * the human-in-the-loop callback so the role gate lives in exactly one place.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlertTriangle,
  Check,
  Keyboard,
  Loader2,
  Mic,
  Settings2,
  X,
} from "lucide-react";
import { useI18n, type StringKey } from "@/lib/i18n";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { parseVoiceCommand, processVoiceTranscript } from "@/lib/ai/voice";
import type { ParsedCommand, VoiceIntent } from "@/lib/ai/voice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How long the result/confirmation HUD stays on screen (ms). */
const HUD_MS = 2800;
/** Global hold-to-talk key (backtick) — ignored while typing. */
const HOLD_KEY = "`";
/**
 * A press shorter than this is a TAP (open the command palette); anything longer
 * is a HOLD (talk). The microphone is only opened once the press passes this
 * threshold, so a tap never records and never triggers a permission prompt.
 */
const TAP_MS = 260;
/** First-run instruction bubble — dismissal is remembered on the device. */
const HINT_KEY = "cl.ptt.hint";
/** Custom HUD equipment: position + density, remembered per device. */
const HUD_POS_KEY = "cl.ptt.hud.pos";
const HUD_DENSITY_KEY = "cl.ptt.hud.density";
type HudPos = "center" | "right";
type HudDensity = "compact" | "comfort";
function readHudPref<T extends string>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Match the physical backquote key, not only the character it produces. `e.key`
 * is layout- and dead-key dependent — and empty for a dead key — so on a non-US
 * layout the hold never started. `code` is position-based and always reliable.
 */
function isHoldKey(e: KeyboardEvent): boolean {
  return e.code === "Backquote" || e.key === HOLD_KEY;
}

type Result = { label: string; source: "rules" | "local"; kind: string };

const ENGINE_KEYS: Record<string, StringKey> = {
  "web-speech": "voice.ptt.engine.webspeech",
  whisper: "voice.ptt.engine.whisper",
  none: "voice.ptt.engine.none",
};

const ERROR_KEYS: Record<string, StringKey> = {
  permission: "voice.ptt.permission",
  unsupported: "voice.ptt.unsupported",
  "start-failed": "voice.ptt.startError",
  "scribe-error": "voice.ptt.startError",
};

function isEditableTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  const tag = node?.tagName?.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    node?.isContentEditable === true
  );
}

export function PushToTalk({
  onIntent,
  onOpenDialog,
}: {
  onIntent: (intent: VoiceIntent) => void;
  onOpenDialog: () => void;
}) {
  const { t, locale } = useI18n();
  const {
    supported,
    engine,
    listening,
    processing,
    interim,
    error,
    begin,
    end,
    cancel,
  } = usePushToTalk(locale);

  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState<ParsedCommand | null>(null);
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<Result[]>([]);
  const [lastText, setLastText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const listenStart = useRef<number | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [hudPos, setHudPos] = useState<HudPos>(() =>
    readHudPref<HudPos>(HUD_POS_KEY, "center")
  );
  const [hudDensity, setHudDensity] = useState<HudDensity>(() =>
    readHudPref<HudDensity>(HUD_DENSITY_KEY, "compact")
  );
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);
  // One control, two gestures: a tap types a command, a hold talks.
  const [pressing, setPressing] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceArmed = useRef(false);
  const [showHint, setShowHint] = useState(false);

  const flash = useCallback(
    (label: string, source: "rules" | "local", kind: string) => {
      const next = { label, source, kind };
      setResult(next);
      setHistory((h) => [next, ...h].slice(0, 3));
      if (hudTimer.current) clearTimeout(hudTimer.current);
      hudTimer.current = setTimeout(() => setResult(null), HUD_MS);
    },
    []
  );

  const dismissHud = useCallback(() => {
    genRef.current += 1; // invalidate any in-flight local-LLM run
    if (hudTimer.current) clearTimeout(hudTimer.current);
    setThinking(false);
    setResult(null);
    setPending(null);
  }, []);

  const pauseHud = useCallback(() => {
    if (hudTimer.current) clearTimeout(hudTimer.current);
  }, []);

  const resumeHud = useCallback(() => {
    if (!result || pending) return;
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setResult(null), 1500);
  }, [result, pending]);

  const setPos = useCallback((p: HudPos) => {
    setHudPos(p);
    try {
      window.localStorage.setItem(HUD_POS_KEY, p);
    } catch {
      /* private mode */
    }
  }, []);

  const setDensity = useCallback((d: HudDensity) => {
    setHudDensity(d);
    try {
      window.localStorage.setItem(HUD_DENSITY_KEY, d);
    } catch {
      /* private mode */
    }
  }, []);

  const runIntent = useCallback(
    (intent: VoiceIntent, source: "rules" | "local") => {
      if (intent.kind === "unknown") {
        flash(intent.label, source, "unknown");
        return;
      }
      onIntent(intent);
      flash(intent.label, source, intent.kind);
    },
    [flash, onIntent]
  );

  /** Interpret one transcript and act — shared by release and error-retry. */
  const executeTranscript = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) {
        flash(t("voice.ptt.empty"), "rules", "unknown");
        return;
      }
      setLastText(text);
      let parsed = parseVoiceCommand(text);
      let source: "rules" | "local" = "rules";
      // Rules cover the whole grammar; only genuinely ambiguous speech defers to
      // the on-device model (so the common case stays instant).
      if (parsed.intent.kind === "unknown") {
        const gen = ++genRef.current;
        setThinking(true);
        try {
          const smart = await processVoiceTranscript(text);
          if (gen !== genRef.current) return; // stale: dismissed/retried since
          parsed = smart.command;
          source = smart.source === "local-llm" ? "local" : "rules";
        } finally {
          if (gen === genRef.current) setThinking(false);
        }
      }
      if (parsed.requiresApproval && parsed.intent.kind !== "unknown") {
        setPending(parsed);
        return;
      }
      runIntent(parsed.intent, source);
    },
    [flash, runIntent, t]
  );

  /** Release handler: finalise the transcript, then interpret it at once. */
  const submit = useCallback(async () => {
    const text = await end();
    await executeTranscript(text);
  }, [end, executeTranscript]);

  const retry = useCallback(() => {
    if (!lastText.trim() || thinking) return; // one run at a time
    void executeTranscript(lastText);
  }, [lastText, thinking, executeTranscript]);

  const hideHint = useCallback(() => {
    setShowHint(false);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* private mode — the bubble just returns next visit */
    }
  }, []);

  /** Arm the hold; the mic opens only once the press passes TAP_MS. */
  const armHold = useCallback(() => {
    voiceArmed.current = false;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      voiceArmed.current = true;
      begin();
    }, TAP_MS);
  }, [begin]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
      setPending(null);
      setPressing(true);
      armHold();
    },
    [armHold]
  );

  /** Release: an armed hold submits the transcript, a quick tap types instead. */
  const release = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPressing(false);
    if (voiceArmed.current) {
      voiceArmed.current = false;
      void submit();
      return;
    }
    hideHint();
    onOpenDialog();
  }, [submit, onOpenDialog, hideHint]);

  /** Abandon a press without acting — used for pointercancel and drag-away. */
  const abortHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPressing(false);
    if (voiceArmed.current) {
      voiceArmed.current = false;
      cancel();
    }
  }, [cancel]);

  /** A press that drags off the button is neither a tap nor a deliberate send. */
  const onPointerLeave = useCallback(() => {
    if (voiceArmed.current) release();
    else abortHold();
  }, [release, abortHold]);

  // Global hold-to-talk — one listener, skipped while typing in a field.
  useEffect(() => {
    let held = false;

    const down = (e: KeyboardEvent) => {
      if (!isHoldKey(e) || e.repeat || e.metaKey || e.ctrlKey || e.altKey)
        return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setPending(null);
      held = true;
      begin();
    };

    // The release must always end the hold. Gating this on the event target (as
    // it was) dropped the release whenever focus moved mid-hold — into the
    // command palette, or onto the HUD's confirm button — which left the mic
    // recording until the 30s safety cap.
    const up = (e: KeyboardEvent) => {
      if (!isHoldKey(e) || !held) return;
      held = false;
      void submit();
    };

    // Losing the window mid-hold never delivers keyup at all, so the mic would
    // stay open. Cancel rather than submit: an interrupted hold was not a
    // deliberate release, and a half-heard command should not run.
    const abandon = () => {
      if (!held) return;
      held = false;
      cancel();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", abandon);
    document.addEventListener("visibilitychange", abandon);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", abandon);
      document.removeEventListener("visibilitychange", abandon);
    };
  }, [begin, submit, cancel]);

  // Show the gesture instructions once per device until dismissed.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(HINT_KEY)) setShowHint(true);
    } catch {
      setShowHint(true);
    }
  }, []); // prefs are lazy useState init — no post-mount sets

  // Escape dismisses any visible HUD state — keyboard users are never trapped.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCustom(false);
        dismissHud();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissHud]);

  // VoiceDraft elapsed-timer pattern: mm:ss while the mic is live.
  useEffect(() => {
    if (!listening) {
      listenStart.current = null;
      setElapsed(0);
      return;
    }
    listenStart.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      if (listenStart.current == null) return;
      setElapsed(Math.floor((Date.now() - listenStart.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [listening]);

  useEffect(
    () => () => {
      if (hudTimer.current) clearTimeout(hudTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    []
  );

  const approve = useCallback(() => {
    if (!pending) return;
    const intent = pending.intent;
    setPending(null);
    runIntent(intent, "rules");
  }, [pending, runIntent]);

  const errorKey = error ? ERROR_KEYS[error] ?? "voice.ptt.startError" : null;
  const visible =
    listening ||
    processing ||
    thinking ||
    Boolean(result) ||
    Boolean(pending) ||
    Boolean(errorKey);

  return (
    <>
      {/* Live HUD — transcript, thinking, confirmation and result in one place.
          Custom equipment: position + density persist per device; hover/focus
          pauses auto-dismiss; Escape or X dismisses; last 3 results kept. */}
      {visible && (
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex px-4 lg:bottom-8",
            hudPos === "center" ? "justify-center" : "justify-end"
          )}
        >
          <div
            className={cn(
              "flex w-full flex-col",
              hudPos === "center" ? "max-w-xl" : "max-w-md"
            )}
          >
            <div
              role="status"
              aria-live={errorKey || pending ? "assertive" : "polite"}
              aria-atomic="true"
              onMouseEnter={pauseHud}
              onMouseLeave={resumeHud}
              onFocus={pauseHud}
              onBlur={resumeHud}
              className={cn(
                "pointer-events-auto flex w-full items-center gap-3 border shadow-xl backdrop-blur",
                hudDensity === "comfort"
                  ? "rounded-2xl px-5 py-3.5"
                  : "rounded-full px-4 py-2.5",
                listening || processing || thinking
                  ? "border-gold/60 bg-cobble/95 text-[#F5F1EA]"
                  : "border-gold/40 bg-card/95 text-cobble-ink"
              )}
            >
              {/* Leading state glyph */}
              <span className="shrink-0">
                {listening ? (
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold/70 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-gold" />
                  </span>
                ) : thinking || processing ? (
                  <Loader2
                    className="h-4 w-4 animate-spin text-gold-ink"
                    aria-hidden
                  />
                ) : pending ? (
                  <AlertTriangle
                    className="h-4 w-4 text-gold-ink"
                    aria-hidden
                  />
                ) : errorKey ? (
                  <AlertTriangle
                    className="h-4 w-4 text-[#d08a4a]"
                    aria-hidden
                  />
                ) : (
                  <Check className="h-4 w-4 text-gold-ink" aria-hidden />
                )}
              </span>

              {/* Body */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {listening
                    ? interim || t("voice.ptt.listening")
                    : thinking || processing
                    ? t("voice.ptt.thinking")
                    : pending
                    ? pending.intent.label
                    : errorKey
                    ? t(errorKey)
                    : result?.label}
                </p>
                {listening && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#B9C4CE]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#b04a48] px-1.5 py-px text-[9px] font-semibold text-white motion-reduce:animate-none animate-pulse">
                      <span
                        className="h-1 w-1 rounded-full bg-white"
                        aria-hidden
                      />
                      Live
                    </span>
                    {t("voice.ptt.release")} · {Math.floor(elapsed / 60)}:
                    {String(elapsed % 60).padStart(2, "0")}
                  </p>
                )}
                {errorKey && lastText.trim() && (
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-1 h-8 min-h-8 rounded-full border border-gold/40 px-3 text-[11px] font-medium text-gold-ink transition-colors hover:bg-gold/10 focus-visible:outline-2 focus-visible:outline-gold"
                  >
                    Retry — “{lastText.trim().slice(0, 40)}
                    {lastText.trim().length > 40 ? "…" : ""}”
                  </button>
                )}
              </div>

              {/* Trailing actions / meta */}
              {pending ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={approve}
                    className="h-8 min-h-8 bg-gold text-cobble-ink hover:bg-gold/90"
                  >
                    <Check className="h-3.5 w-3.5" /> {t("voice.ptt.run")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPending(null)}
                    className="h-8 min-h-8"
                  >
                    <X className="h-3.5 w-3.5" /> {t("voice.ptt.dismiss")}
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    {listening
                      ? t(ENGINE_KEYS[engine] ?? "voice.ptt.engine.none")
                      : result
                      ? result.source === "local"
                        ? t("voice.source.local")
                        : t("voice.source.rules")
                      : ""}
                  </span>
                  {(result || errorKey) && (
                    <button
                      type="button"
                      onClick={dismissHud}
                      aria-label={t("voice.ptt.dismiss")}
                      title={t("voice.ptt.dismiss")}
                      className="inline-flex h-6 min-h-6 w-6 min-w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-cobble-ink focus-visible:outline-2 focus-visible:outline-gold"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowCustom((v) => !v)}
                    aria-label="Customize HUD"
                    title="Customize HUD"
                    aria-expanded={showCustom}
                    className="inline-flex h-6 min-h-6 w-6 min-w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-cobble-ink focus-visible:outline-2 focus-visible:outline-gold"
                  >
                    <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              )}
            </div>
            {/* Custom-equipment panel: position + density */}
            {showCustom && (
              <div
                role="dialog"
                aria-label="Customize HUD"
                className="pointer-events-auto mt-2 w-full rounded-xl border border-gold/40 bg-card/95 p-3 shadow-xl backdrop-blur"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Position
                  </span>
                  <div className="flex gap-1">
                    {(["center", "right"] as HudPos[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPos(p)}
                        aria-pressed={hudPos === p}
                        className={cn(
                          "h-8 min-h-8 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-gold",
                          hudPos === p
                            ? "bg-cobble text-gold-ink"
                            : "text-muted-foreground hover:text-cobble-ink"
                        )}
                      >
                        {p === "center" ? "Center" : "Right"}
                      </button>
                    ))}
                  </div>
                  <span className="ml-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Size
                  </span>
                  <div className="flex gap-1">
                    {(["compact", "comfort"] as HudDensity[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDensity(d)}
                        aria-pressed={hudDensity === d}
                        className={cn(
                          "h-8 min-h-8 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-gold",
                          hudDensity === d
                            ? "bg-cobble text-gold-ink"
                            : "text-muted-foreground hover:text-cobble-ink"
                        )}
                      >
                        {d === "compact" ? "Compact" : "Comfort"}
                      </button>
                    ))}
                  </div>
                </div>
                {!supported && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {t("voice.ptt.unsupported")} — tap still opens the command
                    palette.
                  </p>
                )}
              </div>
            )}
            {/* Recent results — the last 3 commands stay glanceable */}
            {!listening && !thinking && !processing && history.length > 1 && (
              <ul
                aria-label="Recent voice commands"
                className="pointer-events-auto mt-2 flex w-full flex-col gap-1"
              >
                {history.slice(1, 3).map((h, i) => (
                  <li
                    key={`${h.label}-${i}`}
                    className="truncate rounded-full border border-gold/20 bg-card/80 px-3 py-1 text-[11px] text-muted-foreground"
                  >
                    {h.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Voice + command — ONE control: hold to talk, tap to type */}
      <div className="fixed bottom-40 right-4 z-50 flex flex-col items-end gap-2 lg:bottom-20">
        {showHint && (
          <div
            role="note"
            className="pointer-events-auto w-64 rounded-lg border border-gold/40 bg-card/95 p-3 shadow-xl backdrop-blur"
          >
            <div className="flex items-start gap-2">
              <Keyboard
                className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-cobble-ink">
                  {t("voice.ptt.hintTitle")}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t("voice.ptt.hintBody")}
                </p>
              </div>
              <button
                type="button"
                onClick={hideHint}
                aria-label={t("voice.ptt.gotIt")}
                title={t("voice.ptt.gotIt")}
                className="-mr-1 -mt-1 inline-flex h-6 min-h-6 w-6 min-w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-cobble-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={hideHint}
              className="mt-2 w-full rounded border border-gold/40 px-2 py-1 text-[11px] font-medium text-gold-ink transition-colors hover:bg-gold/10"
            >
              {t("voice.ptt.gotIt")}
            </button>
          </div>
        )}
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={release}
          onPointerCancel={abortHold}
          onPointerLeave={onPointerLeave}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            // Keyboard users cannot tap or hold a pointer target — Enter/Space
            // opens the command palette, which is the same destination as a tap.
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              hideHint();
              onOpenDialog();
            }
          }}
          aria-label={`${t("voice.ptt.hold")} · ${t("voice.ptt.tap")}`}
          aria-pressed={listening}
          title={`${t("voice.ptt.hold")} · ${t("voice.ptt.tap")} · ${t(
            "voice.ptt.holdKey"
          )}`}
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-1 transition-transform select-none touch-none",
            listening
              ? "scale-105 bg-[#b04a48] text-white ring-[#b04a48]/60"
              : pressing
              ? "scale-95 bg-cobble text-gold-ink ring-gold/60"
              : "bg-cobble text-gold-ink ring-gold/40 hover:scale-105",
            !supported && "opacity-70"
          )}
        >
          <Mic className="h-6 w-6" aria-hidden />
        </button>
      </div>
    </>
  );
}
