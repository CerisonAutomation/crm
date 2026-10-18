/**
 * H2 adapter — AES-256-GCM envelope encryption, per-tenant keys.
 *
 * DEK_org = SHA256(master || orgId): derived per call, nothing stored, nothing
 * to migrate. Envelope enc:v2:{keyId}:{iv}:{tag}:{ct} (base64 parts); keyId is
 * the master fingerprint so reads resolve current vs previous master for
 * rotation. Legacy plaintext passes through open() for the backfill window.
 * v1 envelopes fail closed deliberately: the v1 writer only sealed integration
 * configs, so no v1 row can exist here, and opening them would couple identity
 * PII to the integrations key for zero real rows. Any tamper fails closed.
 * No key configured -> throw, never silent plaintext (approved posture).
 * Server-only (node:crypto). Prisma-free.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { DomainError } from "@/lib/domain/states";
import type { EncryptionPort } from "@/lib/ports/field-encryption";

export const V2_PREFIX = "enc:v2:";
const V1_PREFIX = "enc:v1:";

function sha(data: string | Buffer): Buffer {
  const h = createHash("sha256");
  h.update(data);
  return h.digest();
}

/**
 * Decode a configured master to raw bytes with a 256-bit floor. Hex (64+
 * chars) and strict base64 decode to bytes; anything else counts as UTF-8.
 * Under 32 decoded bytes the master is refused, fail closed. Plain UTF-8
 * masters derive exactly as before, so pre-condition sealed rows keep
 * opening; hex/base64-shaped masters change meaning (lands before prod
 * enablement, no prod rows exist).
 */
function toMasterBytes(raw: string): Buffer {
  const s = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 64 && s.length % 2 === 0)
    return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 44) {
    try {
      const b = Buffer.from(s, "base64");
      if (
        b.length >= 32 &&
        b.toString("base64").replace(/=+$/, "") === s.replace(/=+$/, "")
      )
        return b;
    } catch {
      /* fall through to UTF-8 */
    }
  }
  const b = Buffer.from(s, "utf8");
  if (b.length < 32)
    throw new DomainError(
      "FIELD_ENC_KEY decodes to fewer than 32 bytes - refusing weak master",
      500
    );
  return b;
}

function masters(): { current: Buffer; previous: Buffer | null } {
  const raw = (process.env.FIELD_ENC_KEY ?? "").trim();
  if (!raw)
    throw new DomainError(
      "FIELD_ENC_KEY is not configured - identity fields cannot be sealed",
      500
    );
  const prev = (process.env.FIELD_ENC_KEY_PREVIOUS ?? "").trim();
  return {
    current: sha(toMasterBytes(raw)),
    previous: prev ? sha(toMasterBytes(prev)) : null,
  };
}

function keyIdOf(master: Buffer): string {
  return sha(master).toString("hex").slice(0, 12);
}

function dekFor(master: Buffer, orgId: string): Buffer {
  const h = createHash("sha256");
  h.update(master);
  h.update(orgId);
  return h.digest();
}

function sealWith(master: Buffer, orgId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dekFor(master, orgId), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (b: Buffer): string => b.toString("base64");
  return (
    V2_PREFIX + keyIdOf(master) + ":" + b64(iv) + ":" + b64(tag) + ":" + b64(ct)
  );
}

function openWith(
  master: Buffer,
  orgId: string,
  ivB64: string,
  tagB64: string,
  ctB64: string
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dekFor(master, orgId),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export const fieldEncryption: EncryptionPort = {
  seal(orgId: string, _fieldKey: string, plaintext: string): string {
    if (plaintext.startsWith(V2_PREFIX) || plaintext.startsWith(V1_PREFIX))
      return plaintext;
    const { current } = masters();
    return sealWith(current, orgId, plaintext);
  },
  open(orgId: string, stored: string): string {
    if (!stored.startsWith(V2_PREFIX) && !stored.startsWith(V1_PREFIX))
      return stored;
    if (stored.startsWith(V1_PREFIX))
      throw new DomainError(
        "Legacy v1 envelope cannot be opened by field encryption",
        500
      );
    const parts = stored.slice(V2_PREFIX.length).split(":");
    if (parts.length !== 4)
      throw new DomainError("Malformed field envelope", 500);
    const { current, previous } = masters();
    const [id, iv, tag, ct] = parts;
    const candidates = [current, ...(previous ? [previous] : [])].filter(
      (m) => keyIdOf(m) === id
    );
    if (candidates.length === 0)
      throw new DomainError("No known key opens this field envelope", 500);
    try {
      return openWith(candidates[0], orgId, iv, tag, ct);
    } catch {
      throw new DomainError("Field envelope failed authentication", 500);
    }
  },
  openOrRedact(orgId: string, stored: string): string {
    try {
      return this.open(orgId, stored);
    } catch (err) {
      // Redact fallback is always loud: the message distinguishes rotation
      // ("No known key" — expected during rollover) from tamper/wrong-tenant
      // ("failed authentication") and legacy ("v1 envelope"). Callers with an
      // audit context must record it; this warn is the floor, not the record.
      console.warn(
        "[field-encryption] redact fallback:",
        err instanceof Error ? err.message : err
      );
      return "[redacted]";
    }
  },
  inspectEnvelope(stored: string): { keyId: string } | null {
    if (!stored.startsWith(V2_PREFIX)) return null;
    const parts = stored.slice(V2_PREFIX.length).split(":");
    if (parts.length !== 4 || parts[0].length === 0) return null;
    return { keyId: parts[0] };
  },
  activeKeyId(): string {
    return keyIdOf(masters().current);
  },
  needsReseal(stored: string): boolean {
    const info = this.inspectEnvelope(stored);
    if (!info) return false;
    try {
      return info.keyId !== this.activeKeyId();
    } catch {
      return false;
    }
  },
  isSealed(stored: string): boolean {
    return stored.startsWith(V2_PREFIX) || stored.startsWith(V1_PREFIX);
  },
};
