// H2 port — blob storage contract (Prisma-free, import anywhere).
// Runtime drivers live in src/lib/storage (local/s3/vercel). Services depend
// on StorageProvider, never on the drivers directly. H3 offline default
// resolves without touching disk or network.

export type VaultPut = { key: string; bytes: Uint8Array };
export type VaultGet = { key: string };

export interface StorageProvider {
  put(input: VaultPut): Promise<void>;
  get(input: VaultGet): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export const offlineStorageProvider: StorageProvider = {
  put: async () => undefined,
  get: async () => null,
  exists: async () => false,
  delete: async () => undefined,
};
