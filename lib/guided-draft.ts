"use client";

/**
 * The hand-off between the public guided intake and the signed-in portal.
 *
 * A visitor answers the intake BEFORE an account exists, so there is nowhere
 * server-side to put the answers. They are parked in sessionStorage — not
 * localStorage, because this is one sitting's work and should not resurface
 * days later on a shared machine — and read back by the onboarding wizard so
 * the client is not asked the same questions twice.
 *
 * Treat everything read back as untrusted: it is client-writable. The wizard
 * uses it to PREFILL and to choose a starting step; it never uses it to skip a
 * server-side check, and the enquiry itself is recorded server-side by
 * `/api/enquiries` at the moment it is submitted.
 */
import type { AnswerMap } from "@/lib/domain/guided-intake";

const KEY = "citizen-lane.guided-draft.v1";

export type GuidedDraft = {
  intent: string | null;
  programmeKey: string;
  answers: AnswerMap;
  savedAt: string;
};

export function saveGuidedDraft(draft: GuidedDraft): void {
  if (globalThis.window === undefined) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage disabled (private mode, quota) — the intake still succeeded
    // server-side, so a failure to cache locally must not surface as an error.
  }
}

export function readGuidedDraft(): GuidedDraft | null {
  if (globalThis.window === undefined) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuidedDraft>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.programmeKey !== "string" || !parsed.programmeKey) return null;
    return {
      intent: typeof parsed.intent === "string" ? parsed.intent : null,
      programmeKey: parsed.programmeKey,
      answers: (parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {}) as AnswerMap,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function clearGuidedDraft(): void {
  if (globalThis.window === undefined) return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do — see saveGuidedDraft.
  }
}
