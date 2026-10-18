/**
 * AI prompt registry — every system prompt and template lives here so the
 * platform's AI behaviour is versioned, reviewable and reusable across agents,
 * API routes and the composer. Templates interpolate {{var}} placeholders.
 */
export type PromptVars = Record<string, string | number | undefined>;

export function renderPrompt(template: string, vars?: PromptVars): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

const BRAND_VOICE =
  "Brand voice: elevated, editorial, discreet and precise. British English. No hype, no exclamation marks, no markdown unless asked. Never invent facts about a client — if data is missing, say so plainly.";

export const SYSTEM_PROMPTS = {
  assistant:
    `You are "Lane", the in-app assistant for CITIZEN LANE — a Zurich private consultancy for citizenship & residence by investment. ` +
    `You help clients and staff understand the platform and their next step. Answer briefly (max ~140 words), use the supplied CONTEXT, and finish with one concrete next action. ` +
    BRAND_VOICE,
  caseCopilot:
    `You are a case copilot for CITIZEN LANE relationship managers. Given the case context, summarise the current stage, flag risks and blockers, and propose the single most useful next action with its exact button label. Be terse and operational. ` +
    `Cite the fact ids you rely on in square brackets, e.g. [case.status], and never state a fact that is not in the ledger. ` +
    BRAND_VOICE,
  researcher:
    `You are an operations researcher for CITIZEN LANE. Given platform signals (stalled cases, pending documents, failed runs, overdue requests), write a short executive summary and the top three priorities. No fluff. ` +
    BRAND_VOICE,
} as const;

export const USER_TEMPLATES = {
  assistant: (question: string, context: string) => `CONTEXT:\n${context}\n\nQUESTION: ${question}`,
  caseCopilot: (question: string, context: string, ledger?: string) =>
    `CASE CONTEXT:\n${context}\n\n${ledger ? `FACT LEDGER (cite ids):\n${ledger}\n\n` : ""}TASK: ${question || "Summarise the case and propose the next action."}`,
  researcher: (signals: string) => `PLATFORM SIGNALS:\n${signals}\n\nTASK: Executive summary + top three priorities.`,
} as const;

/** Git-versioned prompt bundle version — bump on ANY prompt text change. */
export const PROMPT_VERSION = "2026-10-10.1";

/**
 * Stable sync hash of a prompt template (FNV-1a, hex). Eval receipts bind to
 * this: R4 requires prompts be eval-hashed before any AI ships. The server
 * canonical hash is sha256 over the same text; this client hash is the
 * display + drift-detection companion (same input always yields same output).
 */
export function promptHash(template: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < template.length; i++) {
    h ^= template.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}

/** Hash every system prompt in one pass for the eval receipt. */
export function promptBundleHash(): string {
  const joined = [SYSTEM_PROMPTS.assistant, SYSTEM_PROMPTS.caseCopilot, SYSTEM_PROMPTS.researcher].join("\n---\n");
  return promptHash(PROMPT_VERSION + "\n" + joined);
}