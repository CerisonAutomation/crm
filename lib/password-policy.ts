/**
 * Password policy — pure and browser-safe (no Prisma/Node imports).
 *
 * Shared by the account-lifecycle service (server) and, later, the sign-up /
 * reset React views (strength meter + client-side hints). Acceptable passwords
 * must be ≥ PASSWORD_MIN_LENGTH characters and contain at least one letter and
 * one digit; the score/label are advisory UX hints only — the same
 * `validatePassword` gate is always re-checked server-side.
 */
import { EN } from "@/lib/i18n/dictionaries/en";

export const PASSWORD_MIN_LENGTH = 10;

/** Bounds for the admin-set minimum. Below 8 is not a policy; above 64 is hostility. */
export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MIN_LENGTH_CEIL = 64;

/** Clamp a stored/typed value into the legal band, falling back to the default. */
export function clampPasswordMinLength(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return PASSWORD_MIN_LENGTH;
  return Math.min(PASSWORD_MIN_LENGTH_CEIL, Math.max(PASSWORD_MIN_LENGTH_FLOOR, Math.round(n)));
}

export type PasswordScore = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "weak" | "fair" | "good" | "strong";
  checks: { length: boolean; lower: boolean; upper: boolean; digit: boolean; symbol: boolean };
};

/** Advisory strength meter — grows with length buckets and character classes. */
export function scorePassword(password: string, minLength: number = PASSWORD_MIN_LENGTH): PasswordScore {
  const checks = {
    length: password.length >= minLength,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };

  const classes = [checks.lower, checks.upper, checks.digit, checks.symbol].filter(Boolean).length;
  const lengthBucket = password.length < minLength ? 0 : password.length < 14 ? 1 : password.length < 18 ? 2 : 3;
  const raw = classes + lengthBucket;

  const score: PasswordScore["score"] = raw <= 1 ? 0 : raw === 2 ? 1 : raw === 3 ? 2 : raw === 4 ? 3 : 4;
  const label: PasswordScore["label"] = score <= 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";

  return { score, label, checks };
}

/** null when acceptable, otherwise an i18n KEY (e.g. "auth.passwordTooShort"), never prose. */
export function validatePassword(password: string, minLength: number = PASSWORD_MIN_LENGTH): string | null {
  if (password.length < minLength) return "auth.passwordTooShort";
  if (!/[A-Za-z]/.test(password)) return "auth.passwordNeedsLetter";
  if (!/\d/.test(password)) return "auth.passwordNeedsDigit";
  return null;
}

/**
 * Resolve a `validatePassword` KEY to an English, human-readable sentence.
 *
 * `validatePassword` returns an i18n key so the browser can translate it, but
 * server-side callers (the account service) throw the value into a DomainError
 * whose `message` ships to the client verbatim — so the key must be turned into
 * prose first, or the API would emit the bare string "auth.passwordTooShort".
 */
export function describePasswordProblem(key: string | null, minLength: number = PASSWORD_MIN_LENGTH): string | null {
  if (!key) return null;
  const template = (EN as Record<string, string>)[key];
  if (!template) return "Password does not meet the policy requirements";
  // The copy carries the minimum as a token so an operator who raises the
  // policy cannot leave a message that states the old number.
  return template.replace(/\{\{\s*min\s*\}\}/g, String(minLength));
}
