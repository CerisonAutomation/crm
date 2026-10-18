// H2 port — AI provider contract (Prisma-free, import anywhere).
// AI proposes/extracts/classifies/drafts; authorised humans decide regulated
// outcomes. H3 offline default refuses with a typed reason instead of
// hallucinating — callers surface it as degraded, never as truth.

export type AiCapability =
  | "extract"
  | "classify"
  | "draft"
  | "summarise"
  | "search"
  | "route";

export type AiRequest = {
  capability: AiCapability;
  input: string;
  correlationId?: string;
};

export type AiResult =
  | { ok: true; output: string; citations: string[]; costCents: number }
  | { ok: false; reason: string };

export interface AIProvider {
  readonly name: string;
  run(request: AiRequest): Promise<AiResult>;
}

export const offlineAIProvider: AIProvider = {
  name: "offline",
  run: async () => ({
    ok: false,
    reason: "offline: AI not available — human review required",
  }),
};
