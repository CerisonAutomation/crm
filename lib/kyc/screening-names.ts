/**
 * Screening names — the query-set builder in front of yente.
 *
 * A sanctions match is only as good as the string you send. Harvested practice
 * (moov-io/watchman's phonetic boost + length/onset penalties; OpenSanctions'
 * `rigour` cost model and `nomenklatura`'s weighted, explainable feature
 * scoring; the sanctions-screening-benchmark's class-wise perturbation
 * taxonomy) all converge on the same shape:
 *
 *   1. **One canonical key** per subject — case-folded, diacritics stripped,
 *      punctuation normalised, honorifics/generational suffixes dropped, name
 *      particles handled, tokens order-insensitive. This is what a queue is
 *      grouped by and what makes "John Smith" and "SMITH, John" the same row.
 *   2. **A small, derived query set** — the strict key, the strict key without
 *      single-letter initials, the first+last key, the surname-only key and a
 *      consonant skeleton — because a single string cannot cover the benign
 *      variation ordinary customers produce (initials, dropped middle names,
 *      transliteration) or the adversarial kind (homoglyphs, zero-width
 *      characters).
 *   3. **Never a verdict.** Keys select *who to ask about*, not who to flag. The
 *      score still comes from yente's matcher and the decision from a human.
 *
 * Deliberately dependency-free, deterministic and browser-safe: the same input
 * must produce byte-identical output in a test, a route and a worker.
 */

/**
 * Format characters (zero-width joiners/spaces, soft hyphen, bidi controls,
 * BOM) — invisible to a reader, fatal to an exact match. They are replaced by a
 * SPACE rather than deleted: a zero-width space inserted inside a token
 * ("Dmitry\u200bKhoroshev") must split it the way a reader perceives it, not
 * glue the halves into a word nobody is called.
 */
const FORMAT_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Any letter or number in any script — used to preserve non-Latin names. */
const HAS_ALNUM = /[\p{L}\p{N}]/u;

/**
 * Common cross-script homoglyphs: Cyrillic/Greek letters that render like Latin
 * ones. Folding them is what makes a homoglyph string ("Мaduro" with a Cyrillic
 * М) reach the same key as its Latin twin. Conservative by design — only
 * codepoints whose Latin counterpart is unambiguous.
 */
const HOMOGLYPHS: Record<string, string> = {
  "\u0430": "a", "\u0432": "b", "\u0433": "r", "\u0435": "e", "\u043A": "k",
  "\u043C": "m", "\u043D": "h", "\u043E": "o", "\u043F": "n", "\u0440": "p",
  "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0456": "i",
  "\u0458": "j", "\u0455": "s", "\u04BB": "h", "\u0501": "d", "\u051B": "q", "\u051D": "w",
  "\u03B1": "a", "\u03B5": "e", "\u03BF": "o", "\u03C1": "p", "\u03C5": "u",
  "\u03BD": "v", "\u03BA": "k", "\u03BC": "m", "\u03C4": "t",
};

/** Honorifics, religious titles and generational suffixes: never part of the name. */
const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "sir", "dame", "lord", "lady",
  "eng", "ing", "avv", "sig", "sigra", "herr", "frau", "monsieur", "madame", "sheikh", "shaykh",
  "haji", "hajji", "hafiz", "rabbi", "imam", "swami", "jr", "sr", "ii", "iii", "iv", "esq",
]);

/**
 * Name particles (nobiliary, Arabic nasab, Dutch/German/Italian/Spanish
 * connectors). Dropped as standalone tokens and as glue on a longer token, so
 * al-Zawahiri / al Zawahiri / alZawahiri / Zawahiri agree.
 */
const PARTICLES = [
  "abdul", "abd", "bin", "bint", "ibn", "ben", "al", "el", "van", "von", "der", "den",
  "de", "del", "della", "delle", "di", "da", "dos", "das", "do", "du", "la", "le", "lo",
  "mac", "mc", "o", "ter", "ten", "st", "saint",
] as const;

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);
const MIN_PARTICIPLE_LENGTH = 3;

/**
 * Fold one string into comparison-ready characters: strip invisible format
 * characters, decompose and drop diacritics, fold homoglyphs, lowercase, and
 * reduce every non-alphanumeric run to a single space.
 *
 * German umlauts expand before the diacritics are dropped, so "Müller" and
 * "Mueller" fold together (the benchmark's `diacritics_expand` class).
 */
export function foldName(input: string): string {
  const expanded = input
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss");
  const folded = expanded
    .replace(FORMAT_CHARS, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split("")
    .map((ch) => HOMOGLYPHS[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // A name written in a script this fold does not cover (CJK, Cyrillic that is
  // not a Latin look-alike, …) must NOT collapse to the empty key: that would
  // put every such applicant in one row. Preserve it as its own key instead.
  if (!folded && HAS_ALNUM.test(input)) {
    return input.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  }
  return folded;
}

/** Fold → tokens → drop titles and particles (glued or separate). */
export function nameTokens(input: string): string[] {
  const folded = foldName(input).split(" ").filter(Boolean);

  const out: string[] = [];
  for (const token of folded) {
    if (TITLES.has(token)) continue;
    const stripped = stripGluedParticle(token);
    if (PARTICLES.includes(stripped as (typeof PARTICLES)[number])) continue;
    out.push(stripped);
  }
  return out;
}

/** "alzawahiri" → "zawahiri"; "dellarobbia" → "robbia"; unknown glues untouched. */
function stripGluedParticle(token: string): string {
  for (const particle of [...PARTICLES].sort((a, b) => b.length - a.length)) {
    if (!token.startsWith(particle)) continue;
    const rest = token.slice(particle.length);
    if (rest.length >= MIN_PARTICIPLE_LENGTH) return rest;
  }
  return token;
}

/** Order-insensitive, de-duplicated key over a token list. */
function keyOf(tokens: readonly string[]): string {
  return [...new Set(tokens.filter(Boolean))].sort().join(" ");
}

/** Consonant skeleton — `Muhammad`/`Mohammed`/`Mohamad` → `mhmd` (phonetic boost, cheaply). */
function skeleton(tokens: readonly string[]): string {
  const shapes = tokens.map((token) => {
    const chars = [...token];
    let out = "";
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      if (i > 0 && VOWELS.has(ch)) continue;
      if (out.endsWith(ch)) continue; // collapse doubles: Hussein/Husein
      out += ch;
    }
    return out;
  });
  return keyOf(shapes);
}

/**
 * The subject key: every token, order-insensitive. Two spellings that differ
 * only by case, diacritics, punctuation, honorifics, particles or token order
 * produce the SAME key — which is exactly the point.
 */
export function screeningNameKey(input: string): string {
  const tokens = nameTokens(input);
  return keyOf(tokens);
}

export type ScreeningNameKeys = {
  /** Strict key — the whole name, folded and order-insensitive. */
  strict: string;
  /** Strict key without single-letter initials (John A. Smith ≡ John Smith). */
  withoutInitials: string;
  /** First + last token only (drops middle names and patronymics). */
  firstLast: string;
  /** Surname only — the widest key in the set. */
  surname: string;
  /** Consonant skeleton — survives transliteration drift. */
  phonetic: string;
};

/**
 * The key set for one subject. All keys are derived from the same folded token
 * list, so a "variant" spelling that yields any key in common shares a row.
 */
export function screeningNameKeys(input: string): ScreeningNameKeys {
  const tokens = nameTokens(input);
  const withoutInitials = tokens.filter((t) => t.length > 1);
  const firstLast = tokens.length > 1 ? [tokens[0], tokens[tokens.length - 1]] : tokens;
  const surname = tokens.length > 0 ? [tokens[tokens.length - 1]] : [];
  return {
    strict: keyOf(tokens),
    withoutInitials: keyOf(withoutInitials),
    firstLast: keyOf(firstLast),
    surname: keyOf(surname),
    phonetic: skeleton(tokens),
  };
}

/**
 * The strings to actually send to the matcher: the name as typed, plus the
 * reorderings that a structured query cannot express (comma form, surname-first,
 * a dropped middle token). Capped and de-duplicated so one subject is a handful
 * of queries, never a combinatorial explosion.
 */
/**
 * Default noise floor for `/api/screenings/match`.
 *
 * Screening has two distinct numbers, and conflating them is how noise reaches a
 * reviewer. `threshold` (owned by the matcher) is the score at which something is
 * reported as a *match*. `cutoff` is a lower floor: candidates at or below it are
 * dropped from the response entirely, so a query on a common name does not return
 * a page of 0.05-scoring strangers that reads as "here are your hits".
 *
 * Modelled on yente's `score_results(threshold=..., cutoff=...)`
 * (`integration/kyc-harvest/yente/src/scoring.py`), which keeps the two separate
 * and drops with `if response.score <= cutoff: continue`.
 *
 * Defaults to 0.0 — dropping nothing — so existing callers see identical output
 * unless they explicitly opt into a floor.
 */
export const SCREENING_CUTOFF = 0.0;

export function screeningQueries(input: string, limit = 4): string[] {
  const tokens = nameTokens(input);
  if (tokens.length === 0) return [];
  const candidates = [
    input.trim().replace(/\s+/g, " "),
    tokens.join(" "),
    tokens.length > 1 ? [...tokens].reverse().join(" ") : "",
    tokens.length > 2 ? [tokens[0], tokens[tokens.length - 1]].join(" ") : "",
    tokens.length > 1 ? tokens[tokens.length - 1] : "",
  ];
  const out: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate.trim();
    if (clean.length < 2) continue;
    if (out.some((seen) => foldName(seen) === foldName(clean))) continue;
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Do two subjects share a key? Returns the shared key NAME (for an explanation
 * string) or null. `strict` restricts the comparison to the strict key — use it
 * when a caller must not merge on a surname skeleton.
 */
export function sharedScreeningKey(
  a: string,
  b: string,
  mode: "any" | "strict" = "any",
): keyof ScreeningNameKeys | null {
  const left = screeningNameKeys(a);
  const right = screeningNameKeys(b);
  const names: Array<keyof ScreeningNameKeys> =
    mode === "strict" ? ["strict"] : ["strict", "withoutInitials", "firstLast", "phonetic", "surname"];
  for (const name of names) {
    if (left[name] && left[name] === right[name]) return name;
  }
  return null;
}
