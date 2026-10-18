/**
 * AI provider port — SERVER-SIDE.
 *
 * This platform runs AI **in the browser only** (see `@/lib/ai/browser`): Scribe
 * (Whisper speech-to-text), on-device translation and Tesseract OCR. A server
 * route cannot run a browser model, so `aiChat` deliberately resolves to `null`
 * and every caller uses its own deterministic, clearly-labelled fallback.
 *
 * There is intentionally no server model endpoint — no local runtime, no cloud,
 * no API key, nothing to configure. Nothing here reaches the network.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatResult = { text: string; provider: string };

export async function aiChat(
  messages: ChatMessage[],
  opts?: { timeoutMs?: number; disableThinking?: boolean }
): Promise<ChatResult | null> {
  // ponytail: server-side AI stub — browser-only platform, no server model needed.
  // Ceiling: if server-side AI is needed, implement here with proper API key management.
  void messages;
  void opts;
  return null;
}
