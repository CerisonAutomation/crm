/**
 * LLM cost into per-case P/L (Annex BILL: per-case P/L incl LLM cost).
 *
 * On-device inference costs exactly zero. Cloud fallback (OpenRouter) is
 * priced per 1K tokens in minor units (Rappen-equivalent cents) so it sums
 * cleanly with fees. AiRun already carries costCents/latencyMs columns: the
 * server route persists buildAiRunCost() output; casePL() folds every run
 * into the margin. Prisma-free and pure — unit-testable anywhere.
 */

export type CloudModelId = "openai/gpt-4o-mini" | "anthropic/claude-3-haiku" | "google/gemini-flash-1.5" | "meta-llama/llama-3.1-8b-instruct";

/** Price per 1K tokens, minor units (input, output). Sources: provider pages, Oct 2026. */
export const CLOUD_PRICES: Record<CloudModelId, { inPer1k: number; outPer1k: number }> = {
  "openai/gpt-4o-mini": { inPer1k: 0.015, outPer1k: 0.06 },
  "anthropic/claude-3-haiku": { inPer1k: 0.025, outPer1k: 0.125 },
  "google/gemini-flash-1.5": { inPer1k: 0.0075, outPer1k: 0.03 },
  "meta-llama/llama-3.1-8b-instruct": { inPer1k: 0.005, outPer1k: 0.01 },
};

export const DEFAULT_CLOUD_MODEL: CloudModelId = "openai/gpt-4o-mini";

/** Rough token estimate for cost capping (chars/4, the standard heuristic). */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) / 4));
}

/** Cost cap per cloud call: refuse to send prompts past this (chars). */
export const CLOUD_PROMPT_CHAR_CAP = 20000;

/** Minor-unit cost of one cloud call. Unknown models price as the default. */
export function cloudCostCents(model: string, inTokens: number, outTokens: number): number {
  const price = (CLOUD_PRICES as Record<string, { inPer1k: number; outPer1k: number }>)[model] ?? CLOUD_PRICES[DEFAULT_CLOUD_MODEL];
  return (inTokens / 1000) * price.inPer1k + (outTokens / 1000) * price.outPer1k;
}

/**
 * Build the AiRun cost patch the server route persists after a cloud call.
 * Local tiers return zero cost. costCents keeps its exact legacy semantics
 * (2dp minor units, ceil-display); costMillicents is the exact integer cost
 * in thousandths of a cent — every sum/cap reads millis (S4 epoch rule).
 */
export function buildAiRunCost(input: { placement: "local" | "cloud" | "none"; model: string; promptChars: number; completionChars: number; latencyMs: number }): { costCents: number; costMillicents: number; latencyMs: number } {
  if (input.placement !== "cloud") return { costCents: 0, costMillicents: 0, latencyMs: input.latencyMs };
  const cost = cloudCostCents(input.model, estimateTokens(input.promptChars), estimateTokens(input.completionChars));
  return { costCents: Math.round(cost * 100) / 100, costMillicents: Math.max(0, Math.round(cost * 1000)), latencyMs: input.latencyMs };
}

export type CasePL = { revenueCents: number; llmCostCents: number; runCount: number; marginCents: number; marginPct: number | null };

/** Per-case P/L: invoiced revenue minus summed LLM cost (exact millis, S4). */
export function casePL(input: { feeCents: number; aiRuns: readonly { costCents: number | null; costMillicents?: number | null }[] }): CasePL {
  const millis = input.aiRuns.reduce((sum, r) => sum + (r.costMillicents ?? Math.round((r.costCents ?? 0) * 1000)), 0);
  const llmCostCents = Math.round((millis / 1000) * 1000) / 1000;
  const marginCents = Math.round((input.feeCents - llmCostCents) * 1000) / 1000;
  return {
    revenueCents: input.feeCents,
    llmCostCents,
    runCount: input.aiRuns.length,
    marginCents,
    marginPct: input.feeCents > 0 ? Math.round((marginCents / input.feeCents) * 10000) / 100 : null,
  };
}