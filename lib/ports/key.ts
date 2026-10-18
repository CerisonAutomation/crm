// H2 port — key provider contract (Prisma-free, import anywhere).
// Connector credential encryption keys resolve through this seam (mirrors
// src/lib/ports/field-encryption.ts at the provider level). H3 offline
// default fails CLOSED: no key, no decrypt, loud 503 at use time.

export type KeyRef = { keyId: string };

export interface KeyProvider {
  readonly name: string;
  hasKey(): boolean;
  requireKeyId(): string;
}

export const offlineKeyProvider: KeyProvider = {
  name: "offline",
  hasKey: () => false,
  requireKeyId: () => {
    throw new Error(
      "offline: no encryption key configured — refusing to seal or open secrets"
    );
  },
};
