// H2 port — signing contract (Prisma-free, import anywhere).
// Integrity seam: HASH hash-stamp is the offline default (deterministic, no
// network, no fake signatures). QES envelopes (Documenso) are selected only
// when explicitly configured; otherwise fail CLOSED. Runtime lives in
// src/lib/signing/provider.ts.

export type SignatureProviderName = "HASH" | "DOCUMENSO";

export type SealInput = { bytes: Uint8Array; now?: Date };
export type SealResult = {
  contentSha256: string;
  signatureProvider: SignatureProviderName;
  signatureRef: string;
  signedAt: Date;
};

export interface SigningProvider {
  seal(input: SealInput): SealResult;
  readonly name: SignatureProviderName;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// FNV-1a is NOT the production hash (production uses SHA-256 in
// src/lib/signing/provider.ts). This offline stand-in only needs to be
// deterministic without node:crypto so the port stays dependency-free.
function fnvHex(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return `fnv-${(h >>> 0).toString(16).padStart(8, "0")}-${hex(
    bytes.slice(0, 8)
  )}`;
}

export const offlineSigningProvider: SigningProvider = {
  name: "HASH",
  seal: ({ bytes, now }: SealInput): SealResult => {
    const digest = fnvHex(bytes);
    return {
      contentSha256: digest,
      signatureProvider: "HASH",
      signatureRef: `hash:${digest}`,
      signedAt: now ?? new Date(),
    };
  },
};
