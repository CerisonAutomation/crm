/**
 * H2 port — field-level encryption for identity numbers at rest.
 *
 * ExtractedField rows carry passport/MRZ/national-id numbers. Values sealed
 * through this contract read back identical; the envelope carries a key id so
 * rotation never needs a flag day. Pure types + one constant set: Prisma-free.
 */
export const ENCRYPTED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "documentNumber",
  "dateOfBirth",
  "dateOfExpiry",
]);

export function shouldEncryptField(fieldKey: string): boolean {
  return ENCRYPTED_FIELD_KEYS.has(fieldKey);
}

export interface EnvelopeInfo {
  keyId: string;
}

export interface EncryptionPort {
  seal(orgId: string, fieldKey: string, plaintext: string): string;
  open(orgId: string, stored: string): string;
  /** Parse the envelope header without decrypting; null when not sealed. Tamper shows up only at open(). */
  inspectEnvelope(stored: string): EnvelopeInfo | null;
  /** Key id new seals use; throws without a key (fail-closed). */
  activeKeyId(): string;
  /** True when sealed under a non-active key id — re-seal on read. */
  needsReseal(stored: string): boolean;
  /**
   * Open for display; an unopenable envelope (key rotation without a previous
   * key, a v1/malformed envelope, or a value sealed under a different org's
   * DEK) yields a redacted placeholder instead of throwing, so one bad row
   * never fails the whole read.
   */
  openOrRedact(orgId: string, stored: string): string;
  isSealed(stored: string): boolean;
}
