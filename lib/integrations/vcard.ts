/**
 * vCard 3.0 writer — pure, client-safe, zero-dependency.
 *
 * H A R V E S T E D  method: vCard 3.0 (RFC 2426) is the dialect that Apple
 * Contacts (macOS/iOS) and macOS Quick Look import most reliably; vCard 4.0 is
 * still patchily supported by native address books, so 3.0 is the safe target
 * for "Add to Contacts". Field assembly, `\n`/`,`/`;` escaping and the 75-octet
 * line folding follow RFC 2425 §5.8.3 (same folding rule the ICS writer uses).
 *
 * Use it to hand a caller/consultation straight to Apple Contacts or Google
 * Contacts via a downloaded `.vcf` (served with `text/vcard`).
 */

export type VCardInput = {
  firstName?: string | null;
  lastName?: string | null;
  /** Fallback display name when first/last are not split out. */
  fullName?: string | null;
  organisation?: string | null;
  title?: string | null;
  /** Any number of phone numbers (already human-entered; normalised by the UI). */
  phones?: Array<{ value: string; type?: "CELL" | "WORK" | "HOME" | "VOICE" }>;
  emails?: string[];
  urls?: string[];
  addresses?: Array<{ street?: string; city?: string; region?: string; postalCode?: string; country?: string }>;
  note?: string | null;
  /** Stable id so re-imports update rather than duplicate the contact. */
  uid?: string;
};

/** Escape a TEXT value per RFC 2426 (backslash, comma, semicolon, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold lines longer than 75 octets (RFC 2425 §5.8.3). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function splitName(input: VCardInput): { family: string; given: string; display: string } {
  const given = (input.firstName ?? "").trim();
  const family = (input.lastName ?? "").trim();
  if (given || family) {
    const display = [given, family].filter(Boolean).join(" ");
    return { family, given, display };
  }
  const full = (input.fullName ?? "").trim();
  const [first, ...rest] = full.split(/\s+/);
  return { family: rest.join(" "), given: first ?? "", display: full };
}

/** Build a single vCard 3.0 document (CRLF-terminated). */
export function buildVCard(input: VCardInput): string {
  const { family, given, display } = splitName(input);
  const uid = input.uid?.trim() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  lines.push(`N:${escapeText(family)};${escapeText(given)};;;`);
  lines.push(`FN:${escapeText(display || family || given || "Contact")}`);
  if (input.organisation) lines.push(`ORG:${escapeText(input.organisation)}`);
  if (input.title) lines.push(`TITLE:${escapeText(input.title)}`);
  if (input.note) lines.push(fold(`NOTE:${escapeText(input.note)}`));

  for (const phone of input.phones ?? []) {
    if (!phone.value?.trim()) continue;
    lines.push(`TEL;TYPE=${phone.type ?? "CELL"}:${escapeText(phone.value.trim())}`);
  }
  for (const email of input.emails ?? []) {
    if (!email?.trim()) continue;
    lines.push(`EMAIL;TYPE=INTERNET:${escapeText(email.trim())}`);
  }
  for (const url of input.urls ?? []) {
    if (!url?.trim()) continue;
    lines.push(`URL:${escapeText(url.trim())}`);
  }
  for (const a of input.addresses ?? []) {
    const parts = [a.street ?? "", a.city ?? "", a.region ?? "", a.postalCode ?? "", a.country ?? ""].map(escapeText);
    lines.push(fold(`ADR;TYPE=WORK:;;${parts[0]};${parts[1]};${parts[2]};${parts[3]};${parts[4]}`));
  }

  lines.push(`UID:${escapeText(uid)}`, `REV:${new Date().toISOString()}`, "END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** Content-Disposition filename for a `.vcf` download (safe ascii slug). */
export function vcardFileName(display: string): string {
  const slug = (display || "contact").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${slug || "contact"}.vcf`;
}
