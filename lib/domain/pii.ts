/**
 * PII scrubbing for OUTBOUND calls — pure and dependency-free.
 *
 * Every byte this platform sends to a destination it does not fully own is a
 * disclosure of personal data. Today the outbound surfaces are the generic
 * `action.http.webhook` workflow node and the registered webhook-fan-out
 * delivery engine; a future cloud model would be a third. This module is the
 * single redaction boundary those paths call BEFORE the data leaves the
 * process, so the control is one implementation, not a convention each caller
 * might forget.
 *
 * Two independent passes, because a payload leaks PII either by the NAME of a
 * field or by the SHAPE of a value inside free text:
 *   1. KEY pass — a field whose name names a PII attribute (fullName,
 *      dateOfBirth, passportNumber, iban, phone, email, address, …) has its
 *      value replaced wholesale, whatever the value looks like.
 *   2. VALUE pass — inside any remaining string, embedded emails, phone
 *      numbers, IBANs and long digit runs (document / account numbers) are
 *      masked in place, so PII hidden in a note or a template body is caught
 *      even when the field name gives nothing away.
 *
 * Masking is deliberately VISIBLE (`«email»`, `«phone»`, `«redacted»`) rather
 * than silent: a downstream consumer should be able to tell the shape of what
 * was removed. `hasPII()` reports whether a scrub would change anything, for
 * logging/telemetry without emitting the value.
 */

/**
 * Field names that name a personal attribute. Two spellings are covered: a
 * snake/plain form (`full_name`, `name`, `email`) matched case-insensitively,
 * and a camelCase form (a trailing `Name`, `Email`, `Phone`, `Address`) matched
 * case-sensitively on the capital so `filename` / `reference` are NOT caught.
 */
const PII_KEY_PATTERNS: readonly RegExp[] = [
  /(^|_)(full|first|last|middle|given|family)?_?name$/i,
  /Name$/, /FullName$/, /FirstName$/, /LastName$/,
  /(^|_)(e?mail)(_?address)?$/i,
  /Email$/, /EmailAddress$/,
  /(^|_)(phone|mobile|telephone|telefon|whatsapp|msisdn|phone_?number)/i,
  /Phone$/, /Mobile$/,
  /(^|_)(date_?of_?birth|dob|birth(day|date))$/i,
  /DateOfBirth$/,
  /(^|_)(passport|document|id_?card|national_?id|licence|license)_?(number|no|nº|num)?$/i,
  /(Passport|Document|IdCard|IdentityCard|NationalId|Licence|License)Number$/,
  /(^|_)(iban|bic|swift|account_?number|routing|sort_?code)$/i,
  /(Iban|Bic|Swift|AccountNumber)$/,
  /(^|_)(address|street|postal|postcode|zip|city|town)$/i,
  /Address$/, /PostalCode$/,
  /(^|_)(ssn|social_?security|tax_?id|tin|vat_?number|nif)$/i,
  /(^|_)(nationality|country_?of_?birth)$/i,
  /(^|_)(coordinates|latitude|longitude|lat|lon|geo|gps)$/i,
];

/** Value shapes — masked wherever they appear inside a string. */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A phone candidate: optional +, 8–15 digits with common separators.
const PHONE_RE = /(?<!\w)(\+?\d[\d\s().-]{6,}\d)(?!\w)/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
// Long digit runs (7+) with no separators — document/account numbers.
const LONG_DIGITS_RE = /\b\d{7,}\b/g;

export type ScrubOptions = {
  /** Replace an entire PII-named field with this token. Default: `«redacted»`. */
  keyToken?: string;
  /** Cap recursion depth so a pathological/cyclic structure cannot hang. */
  maxDepth?: number;
};

function keyLooksPII(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * A digit run is only a PHONE if it has a phone SHAPE: an explicit international
 * `+`, or a space / parenthesis grouping. A bare dashed run is left alone so a
 * case reference like `CL-2026-0001` is never mistaken for a number.
 */
function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  return candidate.startsWith("+") || /[\s()]/.test(candidate);
}

/** Mask PII value-shapes embedded in a free-text string. */
export function scrubString(input: string): string {
  return input
    .replace(EMAIL_RE, "«email»")
    .replace(IBAN_RE, "«iban»")
    .replace(PHONE_RE, (m) => (looksLikePhone(m) ? "«phone»" : m))
    .replace(LONG_DIGITS_RE, "«number»");
}

/**
 * Deep-scrub a JSON-serialisable value. Returns a NEW value (the input is never
 * mutated). Non-objects pass through except strings, which get the value pass.
 */
export function scrubPII(value: unknown, opts: ScrubOptions = {}): unknown {
  const keyToken = opts.keyToken ?? "«redacted»";
  const maxDepth = opts.maxDepth ?? 12;

  const walk = (v: unknown, depth: number): unknown => {
    if (depth > maxDepth) return "[truncated]";
    if (typeof v === "string") return scrubString(v);
    if (typeof v !== "object" || v === null) return v;
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (keyLooksPII(k) && (typeof val === "string" || typeof val === "number")) {
        out[k] = keyToken;
      } else {
        out[k] = walk(val, depth + 1);
      }
    }
    return out;
  };

  return walk(value, 0);
}

/** True when scrubbing would change the value — for telemetry without disclosing PII. */
export function hasPII(value: unknown): boolean {
  if (typeof value === "string") return scrubString(value) !== value;
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some((v) => hasPII(v));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keyLooksPII(k) && (typeof v === "string" || typeof v === "number")) return true;
    if (hasPII(v)) return true;
  }
  return false;
}

/**
 * Is a URL a TRUSTED internal relay (the same deployment's own loopback)?
 * Only such a target may receive an unscrubbed payload by default — everything
 * else is treated as external and scrubbed.
 */
export function isTrustedRelayUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}
