/** RFC 6238 TOTP (SHA-1, 30s step, 6 digits). Prisma-free pure module. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Unambiguous alphabet for recovery codes (no 0/O/1/I/L). */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { out += BASE32_ALPHABET[(acc >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.trim().replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = BASE32_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Invalid base32 character');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newTotpSecretBytes(): Buffer {
  return randomBytes(20);
}

function hotp(secret: Buffer, counter: bigint, digits: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function totpNow(secret: Buffer, atMs: number = Date.now(), digits: number = TOTP_DIGITS): string {
  const counter = BigInt(Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));
  return hotp(secret, counter, digits);
}

export function verifyTotp(secret: Buffer, code: string, atMs: number = Date.now(), window: number = TOTP_WINDOW_STEPS): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const base = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  const probe = Buffer.from(code, 'utf8');
  for (let d = -window; d <= window; d++) {
    if (base + d < 0) continue; // before the epoch: no counter exists, keep looking
    const candidate = Buffer.from(hotp(secret, BigInt(base + d), TOTP_DIGITS), 'utf8');
    if (probe.length === candidate.length && timingSafeEqual(probe, candidate)) return true;
  }
  return false;
}

export function otpauthUrl(issuer: string, account: string, base32Secret: string): string {
  const label = encodeURIComponent(issuer + ':' + account);
  return 'otpauth://totp/' + label + '?secret=' + base32Secret + '&issuer=' + encodeURIComponent(issuer) + '&digits=6&period=30&algorithm=SHA1';
}

/** One printable recovery code, e.g. XXXX-XXXX (~40 bits). */
export function newRecoveryCode(): string {
  let s = '';
  while (s.length < 8) {
    const b = randomBytes(1)[0];
    if (b < 248) s += RECOVERY_ALPHABET[b % 31];
  }
  return s.slice(0, 4) + '-' + s.slice(4);
}
