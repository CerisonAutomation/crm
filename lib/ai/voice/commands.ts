"use client";
/**
 * Voice command grammar — turns a spoken phrase into a typed, role-checkable
 * intent WITHOUT a network round-trip. Deterministic keyword matching runs
 * first (instant, offline); the on-device model is only consulted for
 * low-confidence phrases (see ./process.ts).
 *
 * The grammar covers the WHOLE shell: navigation to every role-visible view
 * plus the shell interactions (command palette, notifications, help, AI,
 * research, search, theme, locale, scrolling, history, close, sign-out) — so a
 * single hold-to-talk utterance can drive the entire app without a mouse.
 *
 * Every intent carries `requiresApproval` so the caller can enforce the
 * human-in-the-loop gate before anything destructive happens. Only `logout`
 * needs approval; everything else is safe to run the instant it is heard.
 */

export type VoiceLocale = "en" | "de" | "fr" | "it";
export type AdminSub = "automation" | "integrations";

export type VoiceIntent =
  | { kind: "navigate"; view: string; sub?: AdminSub; label: string }
  | { kind: "home"; label: string }
  | {
      kind: "open_ai";
      agent: "assistant" | "case-copilot" | "researcher";
      label: string;
    }
  | { kind: "run_research"; label: string }
  | { kind: "search"; query: string; label: string }
  | { kind: "help"; label: string }
  | { kind: "open_palette"; label: string }
  | { kind: "open_notifications"; label: string }
  | { kind: "mark_all_read"; label: string }
  | { kind: "toggle_theme"; label: string }
  | { kind: "switch_locale"; locale: VoiceLocale; label: string }
  | {
      kind: "scroll";
      direction: "top" | "bottom" | "up" | "down";
      label: string;
    }
  | { kind: "go_back"; label: string }
  | { kind: "close"; label: string }
  | { kind: "logout"; label: string }
  | { kind: "unknown"; label: string };

export type ParsedCommand = {
  transcript: string;
  intent: VoiceIntent;
  /** Convenience mirror of `intent.label` for quick display. */
  label: string;
  /** 0..1 — how sure the rules engine is (low confidence defers to the local model). */
  confidence: number;
  /** Human-in-the-loop: true when the action is destructive / cannot be undone. */
  requiresApproval: boolean;
};

/**
 * Navigation phrases → a view key the shell knows how to open. Ordered MOST
 * SPECIFIC FIRST (first match wins), so "case dashboard" must precede
 * "dashboard" and "page explorer" must precede "pages".
 */
const VIEW_RULES: Array<{
  re: RegExp;
  view: string;
  sub?: AdminSub;
  label: string;
}> = [
  {
    re: /\b(notification cent(?:er|re)|notification centre|alerts? cent(?:er|re))\b/,
    view: "admin-notifications",
    label: "Notification centre",
  },
  {
    re: /\b(audit trail|audit log|audit|governance)\b/,
    view: "admin-audit",
    label: "Audit trail",
  },
  {
    re: /\b(telemetry|analytics|activity log|usage log|product logs)\b/,
    view: "admin-telemetry",
    label: "Telemetry & logs",
  },
  {
    re: /\b(feature flags|flags|toggles)\b/,
    view: "admin-flags",
    label: "Feature flags",
  },
  {
    re: /\b(people|users|user management|roles|staff directory|team members)\b/,
    view: "admin-users",
    label: "People & roles",
  },
  {
    re: /\b(run inspector|run history|executions|runs)\b/,
    view: "studio-runs",
    label: "Run inspector",
  },
  {
    re: /\b(workflow studio|studio|workflows|workflow builder|automations|automation builder)\b/,
    view: "studio-workflows",
    label: "Workflow studio",
  },
  {
    re: /\b(page explorer|explore pages|published pages|public pages|browse pages|library)\b/,
    view: "pages-explore",
    label: "Pages explorer",
  },
  {
    re: /\b(lane pages|page builder|landing pages|page manager|pages list|pages)\b/,
    view: "pages-list",
    label: "Lane pages",
  },
  {
    re: /\b(integrations|connectors|connected apps)\b/,
    view: "admin-automation",
    sub: "integrations",
    label: "Integrations",
  },
  {
    re: /\b(automation|workflow)\b/,
    view: "admin-automation",
    sub: "automation",
    label: "Automation",
  },
  {
    re: /\b(business settings|firm settings|fee schedule|fees|invoices|billing)\b/,
    view: "admin-business",
    label: "Business settings",
  },
  {
    re: /\b(platform settings|console settings|platform config)\b/,
    view: "admin-settings",
    label: "Platform settings",
  },
  {
    re: /\b(pieces|node catalog|node catalogue)\b/,
    view: "admin-pieces",
    label: "Automation pieces",
  },
  {
    re: /\b(admin dashboard|admin overview|admin home|overview)\b/,
    view: "admin-dashboard",
    label: "Admin overview",
  },
  // Same destination as the nav button with these words. First: "start my
  // application" also contains "my application" (dashboard rule below).
  {
    re: /\bstart (my )?application\b/,
    view: "client-apply",
    label: "Apply hub",
  },
  {
    re: /\b(case dashboard|my case|my application|application status)\b/,
    view: "client-dashboard",
    label: "Case dashboard",
  },
  {
    re: /\b(case queue|queue|all cases|open cases|case list|my cases|cases)\b/,
    view: "rm-queue",
    label: "Case queue",
  },
  {
    re: /\b(teams|team chat|internal teams|staff teams)\b/,
    view: "teams",
    label: "Teams",
  },
  {
    re: /\b(onboarding)\b/,
    view: "client-onboarding",
    label: "Onboarding wizard",
  },
  {
    re: /\b(settings|preferences|profile)\b/,
    view: "settings",
    label: "Settings",
  },
];

const RESEARCH_RE =
  /\b(research|what needs (my )?attention|what should i do|find gaps|prioritise|prioritize|priorities|at risk)\b/;
const AI_RE =
  /\b(ask (the )?(ai|assistant)|open (the )?(ai|assistant|console)|copilot)\b/;
const HELP_RE =
  /\b(help|what can (i|you) (do|say)|voice commands|available commands|show shortcuts)\b/;
const PALETTE_RE =
  /\b(command palette|open palette|palette|command bar|quick actions)\b/;
const MARK_READ_RE =
  /\b(mark (all )?(as )?read|mark (all )?notifications? (as )?read|clear notifications?)\b/;
const NOTIF_RE = /\b(notifications?|alerts?|inbox|bell)\b/;
const THEME_RE =
  /\b(dark mode|light mode|dark theme|light theme|night mode|toggle (the )?theme|switch (the )?theme|toggle (the )?dark( mode)?|toggle (the )?light( mode)?)\b/;
const BACK_RE = /\b(go back|back|previous (page|view))\b/;
const CLOSE_RE = /\b(close|dismiss|cancel|escape|never ?mind|go away)\b/;
const HOME_RE =
  /\b(home|start page|main page|go home|home page|take me home)\b/;
const LOGOUT_RE = /\b(sign out|log out|logout|sign me out|log me out)\b/;
const SEARCH_RE = /\b(search|find|look up|show me)\b/;

const LOCALE_WORDS: Array<{ re: RegExp; locale: VoiceLocale; name: string }> = [
  {
    re: /\b(english|englisch|anglais|inglese)\b/,
    locale: "en",
    name: "English",
  },
  {
    re: /\b(german|deutsch|allemand|tedesco)\b/,
    locale: "de",
    name: "Deutsch",
  },
  {
    re: /\b(french|fran|franzoesisch|franzosisch|francese)\b/,
    locale: "fr",
    name: "Français",
  },
  {
    re: /\b(italian|italiano|italien|italienisch)\b/,
    locale: "it",
    name: "Italiano",
  },
];

/** Scroll phrases → a direction. Explicit verbs only (no bare "top"/"down"). */
function scrollDirection(
  text: string
): "top" | "bottom" | "up" | "down" | null {
  if (
    /\b(back to top|top of (the )?page|scroll to (the )?top|go to (the )?top|jump to (the )?top)\b/.test(
      text
    )
  )
    return "top";
  if (
    /\b(bottom of (the )?page|scroll to (the )?bottom|go to (the )?bottom|jump to (the )?bottom)\b/.test(
      text
    )
  )
    return "bottom";
  if (
    /\b(scroll|go|jump|move) (up|down)\b/.test(text) ||
    /\b(page|scroll) (up|down)\b/.test(text)
  ) {
    return /\b(down)\b/.test(text) ? "down" : "up";
  }
  return null;
}

function normalize(text: string): string {
  // LocalVoice postprocess pattern (idea, not code): strip spoken fillers so
  // "um uh open notifications" parses like the typed command. Word-boundaried
  // so "order" keeps its "er".
  // shortcut: English-only fillers; revisit when DE/FR/IT logs show need.
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(umm+|uh+|er+|ah+|hmm+|mhm+|please|kindly)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort entity extraction for "search for …" phrases. */
function extractQuery(raw: string): string {
  const m = raw.match(
    /\b(?:search|find|look up|show me)\b(?:\s+for)?\s+(.+)$/i
  );
  const q = (m?.[1] ?? "").replace(/\b(case|client|please|the)\b/gi, "").trim();
  return q.slice(0, 120);
}

export function parseVoiceCommand(transcript: string): ParsedCommand {
  const raw = transcript.trim();
  const text = normalize(raw);
  // `label` always mirrors the intent's own label, so consumers can read either.
  const build = (
    intent: VoiceIntent,
    confidence: number,
    requiresApproval = false
  ): ParsedCommand => ({
    transcript: raw,
    intent,
    label: intent.label,
    confidence,
    requiresApproval,
  });

  if (!text) return build({ kind: "unknown", label: "Nothing heard" }, 0);

  // ── interactions ──────────────────────────────────────────────────────────
  if (LOGOUT_RE.test(text)) {
    return build({ kind: "logout", label: "Sign out" }, 0.9, true);
  }
  if (HELP_RE.test(text)) {
    return build({ kind: "help", label: "Show voice help" }, 0.75);
  }
  if (RESEARCH_RE.test(text)) {
    return build({ kind: "run_research", label: "Run auto-research" }, 0.85);
  }
  if (AI_RE.test(text)) {
    const agent = /\bcopilot|case\b/.test(text) ? "case-copilot" : "assistant";
    return build(
      {
        kind: "open_ai",
        agent,
        label: `Open the ${
          agent === "case-copilot" ? "case copilot" : "AI assistant"
        }`,
      },
      0.8
    );
  }
  if (PALETTE_RE.test(text)) {
    return build(
      { kind: "open_palette", label: "Open the command palette" },
      0.85
    );
  }

  if (MARK_READ_RE.test(text)) {
    return build(
      { kind: "mark_all_read", label: "Mark all notifications read" },
      0.8
    );
  }
  if (/\bnotification cent(?:er|re)|alerts? cent(?:er|re)\b/.test(text)) {
    return build(
      {
        kind: "navigate",
        view: "admin-notifications",
        label: "Open the notification centre",
      },
      0.85
    );
  }
  if (NOTIF_RE.test(text)) {
    return build(
      { kind: "open_notifications", label: "Open notifications" },
      0.8
    );
  }

  if (THEME_RE.test(text)) {
    return build(
      { kind: "toggle_theme", label: "Toggle dark / light theme" },
      0.85
    );
  }
  const localeWord = LOCALE_WORDS.find((l) => l.re.test(text));
  if (localeWord) {
    return build(
      {
        kind: "switch_locale",
        locale: localeWord.locale,
        label: `Switch language to ${localeWord.name}`,
      },
      0.8
    );
  }

  const dir = scrollDirection(text);
  if (dir) {
    return build(
      { kind: "scroll", direction: dir, label: `Scroll ${dir}` },
      0.8
    );
  }

  if (BACK_RE.test(text)) {
    return build({ kind: "go_back", label: "Go back" }, 0.8);
  }
  if (CLOSE_RE.test(text)) {
    return build({ kind: "close", label: "Close what is open" }, 0.75);
  }
  if (HOME_RE.test(text)) {
    return build({ kind: "home", label: "Go to your home screen" }, 0.8);
  }

  // ── navigation ────────────────────────────────────────────────────────────
  for (const rule of VIEW_RULES) {
    if (rule.re.test(text)) {
      return build(
        {
          kind: "navigate",
          view: rule.view,
          ...(rule.sub ? { sub: rule.sub } : undefined),
          label: `Open ${rule.label}`,
        },
        0.8
      );
    }
  }

  // ── search ────────────────────────────────────────────────────────────────
  if (SEARCH_RE.test(text)) {
    const query = extractQuery(raw);
    if (query) {
      return build(
        { kind: "search", query, label: `Search for “${query}”` },
        0.7
      );
    }
  }

  return build(
    { kind: "unknown", label: `I did not understand: “${raw.slice(0, 80)}”` },
    0.2
  );
}

/** The intent vocabulary the local model is asked to choose from. */
export const INTENT_KEYWORDS = [
  "navigate",
  "research",
  "ai",
  "search",
  "help",
  "home",
  "palette",
  "notifications",
  "mark_read",
  "theme",
  "locale",
  "scroll",
  "back",
  "close",
  "logout",
  "unknown",
] as const;
export type IntentKeyword = (typeof INTENT_KEYWORDS)[number];

/** Map a model-chosen keyword back onto a concrete intent (best-effort). */
export function intentFromKeyword(
  keyword: string,
  transcript: string
): VoiceIntent | null {
  const k = keyword.trim().toLowerCase();
  if (!INTENT_KEYWORDS.includes(k as IntentKeyword)) return null;
  switch (k as IntentKeyword) {
    case "research":
      return { kind: "run_research", label: "Run auto-research" };
    case "ai":
      return {
        kind: "open_ai",
        agent: "assistant",
        label: "Open the AI assistant",
      };
    case "help":
      return { kind: "help", label: "Show voice help" };
    case "home":
      return { kind: "home", label: "Go to your home screen" };
    case "palette":
      return { kind: "open_palette", label: "Open the command palette" };
    case "notifications":
      return { kind: "open_notifications", label: "Open notifications" };
    case "mark_read":
      return { kind: "mark_all_read", label: "Mark all notifications read" };
    case "theme":
      return { kind: "toggle_theme", label: "Toggle dark / light theme" };
    case "back":
      return { kind: "go_back", label: "Go back" };
    case "close":
      return { kind: "close", label: "Close what is open" };
    case "logout":
      return { kind: "logout", label: "Sign out" };
    case "locale": {
      const text = normalize(transcript);
      const word = LOCALE_WORDS.find((l) => l.re.test(text));
      return word
        ? {
            kind: "switch_locale",
            locale: word.locale,
            label: `Switch language to ${word.name}`,
          }
        : null;
    }
    case "scroll": {
      const direction = scrollDirection(normalize(transcript));
      return direction
        ? { kind: "scroll", direction, label: `Scroll ${direction}` }
        : null;
    }
    case "search": {
      const query = extractQuery(transcript) || transcript.slice(0, 80);
      return { kind: "search", query, label: `Search for “${query}”` };
    }
    case "navigate": {
      const text = normalize(transcript);
      const rule = VIEW_RULES.find((r) => r.re.test(text));
      return rule
        ? {
            kind: "navigate",
            view: rule.view,
            ...(rule.sub ? { sub: rule.sub } : undefined),
            label: `Open ${rule.label}`,
          }
        : null;
    }
    default:
      return null;
  }
}
