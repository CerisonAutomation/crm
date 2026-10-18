/**
 * ICS calendar invite writer — server-side, zero-dependency.
 *
 * Produces RFC 5545 text/calendar payloads for consultations, document
 * deadlines and renewal reminders. Served at /api/consultations/[id]/ics and
 * attached to confirmation emails/notifications by reference.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Date → ICS UTC "YYYYMMDDTHHMMSSZ". */
export function icsDateTime(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape per RFC 5545 §3.3.11 TEXT. */
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to ≤75 OCTETS per RFC 5545 §3.1, inserting CRLF + one
 * space at each fold point.
 *
 * Fold points are chosen on UTF-8 octet boundaries so a multi-octet character is
 * never split — `string.length` counts UTF-16 code units, which under-counts
 * non-ASCII content and would slice umlauts/accents in half for the DE/FR/IT
 * dictionaries. Iterating the string yields whole code points, so surrogate
 * pairs (emoji) stay intact too.
 */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  // The first line may use 75 octets; each continuation is prefixed with one
  // space, so it carries at most 74 octets of content.
  let limit = 75;

  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (bytes + chBytes > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += chBytes;
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

export type IcsEventInput = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  /** Minutes; defaults to 45. */
  durationMin?: number;
  organizerName?: string;
  organizerEmail?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  url?: string;
  /** Minutes before start for a VALARM reminder; 0 = none. */
  alarmMin?: number;
};

/** Build a single-event VCALENDAR payload. */
export function buildIcs(input: IcsEventInput): string {
  const end = new Date(input.start.getTime() + (input.durationMin ?? 45) * 60_000);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Citizen Lane//Consultations 1.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${esc(input.uid)}`,
    `DTSTAMP:${icsDateTime(new Date())}`,
    `DTSTART:${icsDateTime(input.start)}`,
    `DTEND:${icsDateTime(end)}`,
    `SUMMARY:${esc(input.title)}`,
  ];
  if (input.description) lines.push(fold(`DESCRIPTION:${esc(input.description)}`));
  if (input.location) lines.push(fold(`LOCATION:${esc(input.location)}`));
  if (input.url) lines.push(fold(`URL:${esc(input.url)}`));
  if (input.organizerEmail) {
    lines.push(
      fold(
        `ORGANIZER;CN=${esc(input.organizerName ?? "Citizen Lane")}:mailto:${input.organizerEmail}`,
      ),
    );
  }
  if (input.attendeeEmail) {
    lines.push(
      fold(
        `ATTENDEE;CN=${esc(input.attendeeName ?? "Client")};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${input.attendeeEmail}`,
      ),
    );
  }
  if (input.alarmMin && input.alarmMin > 0) {
    lines.push(
      "BEGIN:VALARM",
      `TRIGGER:-PT${input.alarmMin}M`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(input.title)}`,
      "END:VALARM",
    );
  }
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/**
 * Session-free invite links are signed with AUTH_SECRET. When it is absent or
 * too weak we FAIL CLOSED rather than minting an ephemeral per-process secret:
 * token links are simply unavailable (verification is refused and no token is
 * issued) until a strong AUTH_SECRET is configured. An ephemeral secret was a
 * silent footgun — links changed meaning on every restart.
 */
function icsSigningSecret(): string | null {
  const configured = env.AUTH_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : null;
}

/** Default lifetime of a session-free invite link (14 days). */
export const ICS_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Pure HMAC over `ics:<consultationId>:<expiresAtMs>` (32 hex chars). */
export function signIcsLinkToken(secret: string, consultationId: string, expiresAtMs: number): string {
  return createHmac("sha256", secret).update(`ics:${consultationId}:${expiresAtMs}`).digest("hex").slice(0, 32);
}

/**
 * Sign a time-limited invite token: `<expiresAtMs>.<hmac>`. The expiry is bound
 * into the signature, so the link stops working once it lapses and can never be
 * replayed indefinitely. Returns null when no signing secret is configured —
 * the caller must then treat the link as unavailable.
 */
export function icsLinkToken(consultationId: string, expiresAtMs: number = Date.now() + ICS_LINK_TTL_MS): string | null {
  const secret = icsSigningSecret();
  if (!secret) return null;
  return `${expiresAtMs}.${signIcsLinkToken(secret, consultationId, expiresAtMs)}`;
}

/** Verify a token against an explicit secret (pure — used by tests). */
export function verifyIcsLinkTokenWithSecret(secret: string, consultationId: string, provided: string): boolean {
  const dot = provided.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(provided.slice(0, dot));
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  const a = Buffer.from(provided.slice(dot + 1));
  const b = Buffer.from(signIcsLinkToken(secret, consultationId, expiresAtMs));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Constant-time verification of a provided invite token. Rejects malformed,
 * tampered and expired tokens, and fails closed when signing is unconfigured.
 */
export function verifyIcsLinkToken(consultationId: string, provided: string): boolean {
  const secret = icsSigningSecret();
  if (!secret) return false;
  return verifyIcsLinkTokenWithSecret(secret, consultationId, provided);
}
