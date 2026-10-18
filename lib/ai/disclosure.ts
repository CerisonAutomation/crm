/**
 * AI-disclosure auto-render (Annex LEG: per-feature AI disclosure).
 *
 * Every user-facing AI feature declares WHAT runs WHERE on WHICH data and
 * for HOW LONG it is kept. getDisclosure() is the single source the UI
 * renders (Ask My Case, voice, OCR, translation, research) and the legal
 * pages quote. Isomorphic and Prisma-free; rendering stays in .tsx files.
 */

export type AiFeatureKey = "ask-my-case" | "voice-command" | "scribe" | "ocr" | "translation" | "research";

export type AiDisclosureData = { feature: string; models: string[]; placement: string; dataUse: string; retention: string; humanReview: string };

function d(feature: string, models: string[], placement: string, dataUse: string, retention: string, humanReview: string): AiDisclosureData {
  return { feature, models, placement, dataUse, retention, humanReview };
}

export const FEATURE_DISCLOSURES: Record<AiFeatureKey, AiDisclosureData> = {
  "ask-my-case": d(
    "Ask My Case",
    ["Server case copilot (grounded, cited)", "Chrome Prompt API Nano (on-device)", "LFM2-350M on-device chat", "OpenRouter cloud (consented only)"],
    "Authoritative answers are computed server-side from your case record; on-device models answer only as a fallback and are labelled unverified.",
    "Your question plus the case facts needed to answer it. Cloud fallback strips passport numbers, emails, phones and dates before sending.",
    "Server answers are kept as AI receipts for audit; on-device inference keeps nothing.",
    "Relationship-manager decisions (approvals, four-eyes) are never delegated to AI."
  ),
  "voice-command": d(
    "Voice commands",
    ["Deterministic command grammar (instant, offline)", "LFM2-350M on-device classifier (ambiguous phrases only)"],
    "Fully on-device. Audio and transcripts never leave this browser.",
    "Microphone audio is transcribed locally; only the recognised command runs.",
    "Transcripts live in memory for the session and are discarded on close.",
    "Destructive actions (sign-out) always ask for confirmation first."
  ),
  scribe: d(
    "Voice notes (Scribe)",
    ["Whisper tiny on-device (WebGPU/WASM, in a worker)"],
    "Fully on-device, transcribed in a background worker.",
    "Audio from your microphone, resampled to 16 kHz for the model.",
    "Audio buffers are transcribed in windows and released; nothing is uploaded.",
    "You review the transcript before it is saved with the call."
  ),
  ocr: d(
    "Document scan (OCR)",
    ["Tesseract.js (same-origin engine and language data)", "Optional Florence-2 region proposal (high-tier devices, opt-in)"],
    "Fully on-device: engine, language data and the document never leave this browser.",
    "The image you choose to scan, parsed for MRZ and form fields.",
    "Scan text is attached to your draft and follows normal case retention.",
    "Low-confidence fields are flagged for human review before submission."
  ),
  translation: d(
    "Translation",
    ["Browser built-in Translation API (first)", "NLLB distilled on-device (fallback)"],
    "Fully on-device.",
    "The text you ask to translate (max 600 characters per call).",
    "Nothing is stored.",
    "Untranslatable text is returned unchanged and labelled, never silently altered."
  ),
  research: d(
    "Auto-research",
    ["Deterministic platform signals (database counts)", "Server model narration when available"],
    "Staff-only, computed server-side from organisation-scoped data.",
    "Aggregated case, document and workflow counts. No client PII in prompts.",
    "Insights follow the standard audit retention schedule.",
    "Priorities are advisory; every action is taken by a person."
  ),
};

export function getDisclosure(feature: AiFeatureKey): AiDisclosureData {
  return FEATURE_DISCLOSURES[feature];
}

/** Ordered bullet lines for details/summary renderers and legal pages. */
export function disclosureLines(feature: AiFeatureKey): string[] {
  const x = FEATURE_DISCLOSURES[feature];
  return [
    "Models: " + x.models.join(", "),
    "Where it runs: " + x.placement,
    "Data used: " + x.dataUse,
    "Kept: " + x.retention,
    "Human review: " + x.humanReview,
  ];
}

/** Plain-text rendering for legal pages, exports and non-React surfaces. */
export function formatDisclosureText(feature: AiFeatureKey): string {
  const x = FEATURE_DISCLOSURES[feature];
  return ["AI disclosure: " + x.feature, ...disclosureLines(feature)].join("\n");
}