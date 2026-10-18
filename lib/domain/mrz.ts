/**
 * MRZ (ICAO 9303 TD3) parsing — pure and client-safe.
 *
 * These helpers live here rather than inside the server OCR adapter so the SAME
 * parser serves both readers: the server-side upload pipeline
 * (`@/lib/adapters/ocr`) and the in-browser extraction on the public guided
 * intake, which never sends the document anywhere. One definition, two
 * consumers — a divergence would mean the same passport read in the browser
 * disagreed with the same passport read at the desk.
 *
 * Nothing here touches the network, the filesystem or a Prisma client: it takes
 * recognised text and returns field values, so it is safe to import into a
 * "use client" component.
 */

/** The canonical field keys, identical to the ones the server adapter persists. */
export type PassportFields = {
  fullName: string | null;
  documentNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  dateOfExpiry: string | null;
  issuingCountry: string | null;
};

/** Normalise a TD3 YYMMDD date to ISO YYYY-MM-DD, or null when implausible. */
export function mrzDate(yymmdd: string, kind: "dob" | "expiry"): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const nowYY = new Date().getFullYear() % 100;
  // Birth dates are in the past; expiry dates are in the current era.
  const year = kind === "dob" ? (yy <= nowYY ? 2000 + yy : 1900 + yy) : 2000 + yy;
  return `${String(year).padStart(4, "0")}-${mm < 10 ? "0" : ""}${mm}-${dd < 10 ? "0" : ""}${dd}`;
}

/** Find the two ~44-char TD3 MRZ lines (document line + data line) in OCR text. */
export function extractMrzLines(text: string): { line1: string; line2: string } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.toUpperCase().replace(/\s+/g, ""))
    .filter((l) => /^[A-Z0-9<]{40,}$/.test(l));
  for (let i = 0; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];
    if (line1.includes("<") && line2.includes("<") && line2.slice(0, 1) !== "<") {
      return { line1, line2 };
    }
  }
  return null;
}

/** Every character an MRZ may legally contain — the recogniser's whitelist. */
export const MRZ_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/** ICAO 9303 character values: 0-9 → 0-9, A-Z → 10-35, '<' → 0. */
function icaoValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // '0'-'9'
  if (code >= 65 && code <= 90) return code - 55; // 'A'-'Z' → 10-35
  if (ch === "<") return 0;
  return 0;
}

/** Compute a single ICAO 9303 check digit (weights 7,3,1 repeating). */
function icaoCheckDigit(str: string): number {
  let sum = 0;
  const weights = [7, 3, 1];
  for (let i = 0; i < str.length; i++) {
    sum += icaoValue(str[i]) * weights[i % 3];
  }
  return sum % 10;
}

/**
 * R1 canonical name for the ICAO 9303 check-digit function. Aliased, never
 * duplicated, so the canon rule and the implementation share one definition.
 */
export const mrzCheckDigit = icaoCheckDigit;

/**
 * Verify all check digits in a TD3 line 2.
 * Returns an object with each check result and the composite validity.
 */
export function verifyTd3CheckDigits(line2Raw: string): {
  documentNumber: boolean;
  dateOfBirth: boolean;
  dateOfExpiry: boolean;
  personalNumber: boolean;
  composite: boolean;
} {
  // Pad to 44 chars and take exact positions (0-indexed).
  const line2 = line2Raw.padEnd(44, "<").slice(0, 44);

  // Document number: positions 1-9 (0-8), check at 10 (9).
  const docNum = line2.slice(0, 9);
  const docCheck = Number(line2[9]) || 0;
  const documentNumber = icaoCheckDigit(docNum) === docCheck;

  // Date of birth: positions 14-19 (13-18), check at 20 (19).
  const dob = line2.slice(13, 19);
  const dobCheck = Number(line2[19]) || 0;
  const dateOfBirth = icaoCheckDigit(dob) === dobCheck;

  // Date of expiry: positions 22-27 (21-26), check at 28 (27).
  const exp = line2.slice(21, 27);
  const expCheck = Number(line2[27]) || 0;
  const dateOfExpiry = icaoCheckDigit(exp) === expCheck;

  // Personal number: positions 29-42 (28-41), check at 43 (42).
  const pers = line2.slice(28, 42);
  const persCheck = Number(line2[42]) || 0;
  const personalNumber = icaoCheckDigit(pers) === persCheck;

  // Composite: positions 1-10 (0-9), 14-20 (13-19), 22-28 (21-27), 29-43 (28-42).
  const compositeStr =
    line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 28) + line2.slice(28, 43);
  const finalCheck = Number(line2[43]) || 0;
  const composite = icaoCheckDigit(compositeStr) === finalCheck;

  return { documentNumber, dateOfBirth, dateOfExpiry, personalNumber, composite };
}

/**
 * Parse + validate a TD3 MRZ. Returns fields + check-digit validity,
 * or null when no MRZ is detected.
 */
export function parsePassportMrzWithChecks(text: string): (PassportFields & {
  checks: ReturnType<typeof verifyTd3CheckDigits>;
}) | null {
  const lines = extractMrzLines(text);
  if (!lines) return null;
  const fields = parseTd3(lines.line1, lines.line2);
  const checks = verifyTd3CheckDigits(lines.line2);
  return { ...fields, checks };
}

/**
 * Cut the padding out of one name component.
 *
 * The MRZ pads its name field with a long run of `<`, and a recogniser
 * frequently renders that padding as a repeated letter instead — `L` for `<`
 * was the observed failure, which spliced sixteen `L`s into the middle of a
 * name. Cutting at the first run of the SAME character three or more times
 * removes the padding while leaving a genuine double letter (`LLOYD`, `ANNA`)
 * untouched, because a real name does not repeat a letter three times.
 */
function stripPadding(part: string): string {
  return part.replace(/([A-Z<])\1{2,}[\s\S]*$/, "").replace(/</g, " ").replace(/\s+/g, " ").trim();
}

/** Parse ICAO 9303 TD3 lines into the canonical field keys. */
export function parseTd3(line1Raw: string, line2Raw: string): PassportFields {
  const line1 = line1Raw.padEnd(44, "<").slice(0, 44);
  const line2 = line2Raw.padEnd(44, "<").slice(0, 44);

  const issuingCountry = line1.slice(2, 5).replace(/</g, "").trim() || null;
  const [primary = "", ...secondary] = line1.slice(5).split("<<");
  const surname = stripPadding(primary);
  const given = secondary.map(stripPadding).filter(Boolean).join(" ");
  const fullName = [given, surname].filter(Boolean).join(" ").trim() || null;

  const documentNumber = line2.slice(0, 9).replace(/</g, "").trim() || null;
  const nationality = line2.slice(10, 13).replace(/</g, "").trim() || null;

  return {
    fullName,
    documentNumber,
    nationality,
    dateOfBirth: mrzDate(line2.slice(13, 19), "dob"),
    dateOfExpiry: mrzDate(line2.slice(21, 27), "expiry"),
    issuingCountry,
  };
}

/**
 * Recognised text → passport fields, or null when the document carries no
 * machine-readable zone (an ID card photographed face-up, a utility bill, a
 * blurry shot). Callers treat null as "we read nothing", never as an error.
 */
export function parsePassportMrz(text: string): PassportFields | null {
  const lines = extractMrzLines(text);
  if (!lines) return null;
  return parseTd3(lines.line1, lines.line2);
}
