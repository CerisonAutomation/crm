"use client";
/**
 * Voice processing — local intelligence, on device.
 *
 * 1. Deterministic rules run first (instant, offline, zero download).
 * 2. Only when the rules are unsure does it ask the LOCAL language model
 *    (Transformers.js, WebGPU→WASM) to classify the request — still on device,
 *    no server, no API key. If the model cannot load, the rules result stands.
 */
import { browserAiAvailable, getPipeline } from "@/lib/ai/browser/pipelines";
import { detectCapabilities } from "@/lib/ai/browser/capabilities";
import { parseVoiceCommand, intentFromKeyword, INTENT_KEYWORDS, type ParsedCommand } from "./commands";
import { MODEL_REGISTRY } from "@/lib/ai/browser/model-registry";

/** Local classifier pin — single source of truth in the model registry. */
const LOCAL_MODEL = MODEL_REGISTRY.chat.id;
const CONFIDENCE_GATE = 0.6;

type Generator = (input: string, opts?: Record<string, unknown>) => Promise<Array<{ generated_text?: string }>>;

async function classifyLocally(transcript: string): Promise<string | null> {
  if (!browserAiAvailable()) return null;
  try {
    const pipe = await getPipeline("text-generation", LOCAL_MODEL);
    if (!pipe) return null;
    const gen = pipe as unknown as Generator;
    const prompt =
      `You are a voice-command classifier. Answer with ONE word only, from this list: ${INTENT_KEYWORDS.join(", ")}.\n` +
      `Request: "${transcript.slice(0, 200)}"\nAnswer:`;
    const out = await gen(prompt, { max_new_tokens: 6, temperature: 0, do_sample: false });
    const text = out?.[0]?.generated_text ?? "";
    const answer = text.includes("Answer:") ? text.split("Answer:").pop() ?? text : text;
    return answer.toLowerCase().match(/[a-z]+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

export type VoiceProcessResult = {
  command: ParsedCommand;
  /** Which engine produced the final intent — shown to the user (never faked). */
  source: "rules" | "local-llm";
  /** Device performance tier used by the local model. */
  tier: string;
};

export async function processVoiceTranscript(transcript: string): Promise<VoiceProcessResult> {
  const ruled = parseVoiceCommand(transcript);
  const tier = detectCapabilities().tier;

  if (ruled.confidence >= CONFIDENCE_GATE) return { command: ruled, source: "rules", tier };

  const keyword = await classifyLocally(transcript);
  const intent = keyword ? intentFromKeyword(keyword, transcript) : null;
  if (intent) return { command: { ...ruled, intent, label: intent.label, confidence: 0.7 }, source: "local-llm", tier };

  return { command: ruled, source: "rules", tier };
}
