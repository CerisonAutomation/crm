"use client";
/**
 * Maps a failed auth call to a translated, user-facing message.
 *
 * The API returns a stable envelope (`{ error, errorCode, correlationId }`). For
 * any unhandled failure that envelope carries the literal string "Internal
 * error" — accurate internally, but not something to show a person. This helper
 * turns known status/code pairs into actionable copy, keeps the precise server
 * message for 4xx validation failures the user can fix, and preserves the
 * correlation id so a reported failure can be traced to the exact request.
 */
import { ApiError } from "@/lib/api-client";
import type { StringKey } from "@/lib/i18n";

export type AuthErrorText = { message: string; reference: string | null };

type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

export function describeAuthError(err: unknown, t: Translate): AuthErrorText {
  if (err instanceof ApiError) {
    const reference = err.correlationId;
    // Duplicate account — the one conflict the user resolves by signing in.
    if (err.status === 409 || err.errorCode === "conflict") {
      return { message: t("auth.emailExists"), reference: null };
    }
    if (err.status === 429 || err.errorCode === "rate_limited") {
      return { message: t("auth.errorRateLimited"), reference };
    }
    if (err.status === 0 || err.errorCode === "network_error") {
      return { message: t("auth.errorNetwork"), reference: null };
    }
    // 4xx validation — the server message is specific and actionable, keep it.
    if (err.status >= 400 && err.status < 500 && err.message) {
      return { message: err.message, reference };
    }
    // Unhandled 5xx — never surface the raw "Internal error" string.
    return { message: t("auth.errorServer"), reference };
  }
  // Non-ApiError (a bug in the client path) — still fail safe with generic copy.
  return { message: t("auth.errorServer"), reference: null };
}
