/**
 * Phone handling — normalisation (E.164), display formatting and the click-to-
 * call / message / FaceTime URL schemes. Pure, client-safe, zero-dependency.
 *
 * H A R V E S T E D  method:
 *  · The E.164 rules and the `tel:` / `sms:` / `facetime:` schemes follow the
 *    approach used by `libphonenumber` (google/libphonenumber) and its JS port
 *    `catamphetamine/libphonenumber-js` — parse to a country code + national
 *    number, validate length, then format. This module implements the subset
 *    for the firm's markets (CH/DE/FR/IT/AT/LI + common dialling countries) so
 *    the platform stays dependency-free.
 *  · Upgrade path: swap `normalizePhone`/`formatPhone` for `libphonenumber-js`
 *    (`parsePhoneNumberFromString(raw, defaultCountry)`) for full validation,
 *    number-type detection and every country — the exported signatures match.
 *
 * Native note: `tel:`/`sms:`/`facetime:` are handled by the OS on iOS, macOS and
 * Android; inside the Capacitor shell they open the native dialer/FaceTime.
 * `@capacitor-community/call-number` can be used for programmatic dialling.
 */

/** Dialling codes for the markets the firm serves (kept intentionally small). */
const COUNTRY_CALLING: Record<string, string> = {
  CH: "41", LI: "423", DE: "49", AT: "43", FR: "33", IT: "39",
  GB: "44", IE: "353", NL: "31", BE: "32", LU: "352", ES: "34",
  PT: "351", US: "1", CA: "1", AE: "971", SG: "65", HK: "852",
};

/** Reverse map used when we must infer a country from a full number. */
const CALLING_TO_ISO: Array<[string, string]> = Object.entries(COUNTRY_CALLING)
  .map(([iso, cc]) => [cc, iso] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

export type PhoneParts = {
  raw: string;
  /** `+<cc><national>` when the input is usable, else null. */
  e164: string | null;
  countryCode: string | null;
  national: string | null;
  valid: boolean;
};

/** Keep a leading `+`, drop every other non-digit. */
function digitsOf(input: string): { plus: boolean; digits: string } {
  const trimmed = (input ?? "").trim();
  const plus = trimmed.startsWith("+");
  return { plus, digits: trimmed.replace(/\D/g, "") };
}

/**
 * Parse a human-entered number into E.164, using `defaultCountry` for national
 * forms (`079 …`, `(0)79 …`) and `00`/`+` international prefixes.
 */
export function normalizePhone(raw: string, defaultCountry = "CH"): PhoneParts {
  const cc = COUNTRY_CALLING[defaultCountry.toUpperCase()] ?? COUNTRY_CALLING.CH;
  const { plus, digits } = digitsOf(raw);
  const base: PhoneParts = { raw: raw ?? "", e164: null, countryCode: null, national: null, valid: false };
  if (!digits) return base;

  let national: string;
  let countryCode: string;

  if (plus) {
    // Fully-qualified international form — infer the country from the prefix.
    const match = CALLING_TO_ISO.find(([c]) => digits.startsWith(c));
    if (!match || digits.length <= match[0].length) return base;
    countryCode = match[0];
    national = digits.slice(match[0].length);
  } else if (digits.startsWith("00")) {
    // International access code (00) — strip it and treat as fully-qualified.
    const rest = digits.slice(2);
    return normalizePhone(`+${rest}`, defaultCountry);
  } else if (digits.startsWith("0")) {
    // National trunk form (`079…` / `(0)79…`) → drop the trunk 0.
    countryCode = cc;
    national = digits.replace(/^0+/, "");
  } else if (digits.length > 10 && digits.startsWith(cc)) {
    // Bare international without + (e.g. `4179…`).
    countryCode = cc;
    national = digits.slice(cc.length);
  } else {
    countryCode = cc;
    national = digits;
  }

  const e164 = `+${countryCode}${national}`;
  // E.164 allows 8–15 digits in total (including the country code).
  const valid = national.length >= 6 && e164.replace(/\D/g, "").length <= 15;
  return { raw: raw ?? "", e164: valid ? e164 : null, countryCode, national, valid };
}

/** Human-friendly grouping, e.g. `+41 79 123 45 67`. Falls back to the raw input. */
export function formatPhone(raw: string, defaultCountry = "CH"): string {
  const parsed = normalizePhone(raw, defaultCountry);
  if (!parsed.valid || !parsed.e164 || !parsed.national) return (raw ?? "").trim();
  const groups = parsed.national.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return `+${parsed.countryCode} ${groups}`;
}

/** `tel:+4179…` for a click-to-call link, or null when unusable. */
export function telHref(raw: string, defaultCountry = "CH"): string | null {
  const parsed = normalizePhone(raw, defaultCountry);
  return parsed.valid && parsed.e164 ? `tel:${parsed.e164}` : null;
}

/** `sms:+4179…?&body=…` (the `sms:` body syntax is the cross-platform form). */
export function smsHref(raw: string, body?: string, defaultCountry = "CH"): string | null {
  const parsed = normalizePhone(raw, defaultCountry);
  if (!parsed.valid || !parsed.e164) return null;
  return body ? `sms:${parsed.e164}?&body=${encodeURIComponent(body)}` : `sms:${parsed.e164}`;
}

/** `facetime:` (audio) or `facetime-audio:`/`facetime:…?video` — Apple schemes. */
export function facetimeHref(raw: string, kind: "audio" | "video" = "audio", defaultCountry = "CH"): string | null {
  const parsed = normalizePhone(raw, defaultCountry);
  if (!parsed.valid || !parsed.e164) return null;
  const bare = parsed.e164.replace(/^\+/, "");
  return kind === "video" ? `facetime:${bare}?video` : `facetime-audio:${bare}`;
}

/** `https://wa.me/<number>?text=…` — the WhatsApp Click-to-Chat API. */
export function whatsappHref(raw: string, text?: string, defaultCountry = "CH"): string | null {
  const parsed = normalizePhone(raw, defaultCountry);
  if (!parsed.valid || !parsed.e164) return null;
  const number = parsed.e164.replace(/^\+/, "");
  return text ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/${number}`;
}

export type ContactActions = {
  e164: string | null;
  display: string;
  tel: string | null;
  sms: string | null;
  facetimeAudio: string | null;
  facetimeVideo: string | null;
  whatsapp: string | null;
};

/**
 * Every action a phone number exposes, ready for a contact/call menu. This is
 * the single call a UI makes to render Call / Message / FaceTime / WhatsApp.
 */
export function contactActions(raw: string, defaultCountry = "CH", smsBody?: string): ContactActions {
  const parsed = normalizePhone(raw, defaultCountry);
  return {
    e164: parsed.e164,
    display: formatPhone(raw, defaultCountry),
    tel: telHref(raw, defaultCountry),
    sms: smsHref(raw, smsBody, defaultCountry),
    facetimeAudio: facetimeHref(raw, "audio", defaultCountry),
    facetimeVideo: facetimeHref(raw, "video", defaultCountry),
    whatsapp: whatsappHref(raw, undefined, defaultCountry),
  };
}
