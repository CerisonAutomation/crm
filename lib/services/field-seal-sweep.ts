/**
 * One-shot backfill: seal legacy plaintext identity-number fields.
 *
 * Rows written before FIELD-ENC carry plaintext values. This sweep seals them
 * in keyset pages (id ASC): idempotent (sealed rows are skipped, so re-runs
 * and overlaps are safe), fail-closed (a missing key counts rows as failed,
 * never writes plaintext), and per-row contained (one bad row never aborts
 * the batch). Run once per environment via prisma/seal-legacy-fields.ts, then
 * verify zero plaintext rows remain before destroying retired masters.
 */
import { db } from "@/lib/db";
import { fieldEncryption } from "@/lib/adapters/field-encryption";
import {
  ENCRYPTED_FIELD_KEYS,
  shouldEncryptField,
} from "@/lib/ports/field-encryption";

export interface SealCandidate {
  id: string;
  fieldKey: string;
  value: string | null;
  orgId: string | null;
}

export interface SealStore {
  listBatch(cursor: string | null, take: number): Promise<SealCandidate[]>;
  sealRow(id: string, value: string): Promise<void>;
}

const dbStore: SealStore = {
  async listBatch(cursor, take) {
    const rows = await db.extractedField.findMany({
      where: {
        fieldKey: { in: [...ENCRYPTED_FIELD_KEYS] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        fieldKey: true,
        value: true,
        document: { select: { case: { select: { orgId: true } } } },
      },
      orderBy: { id: "asc" },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      fieldKey: r.fieldKey,
      value: r.value,
      orgId: r.document?.case?.orgId ?? null,
    }));
  },
  async sealRow(id, value) {
    await db.extractedField.update({ where: { id }, data: { value } });
  },
};

export async function sealLegacyFields(
  store: SealStore = dbStore,
  take = 500
): Promise<{ sealed: number; skipped: number; failed: number }> {
  let sealed = 0;
  let skipped = 0;
  let failed = 0;
  let cursor: string | null = null;
  for (;;) {
    const batch = await store.listBatch(cursor, take);
    if (batch.length === 0) break;
    for (const row of batch) {
      cursor = row.id;
      if (
        !row.value ||
        !shouldEncryptField(row.fieldKey) ||
        !row.orgId ||
        fieldEncryption.isSealed(row.value)
      ) {
        skipped++;
        continue;
      }
      try {
        await store.sealRow(
          row.id,
          fieldEncryption.seal(row.orgId, row.fieldKey, row.value)
        );
        sealed++;
      } catch {
        failed++;
      }
    }
    if (batch.length < take) break;
  }
  return { sealed, skipped, failed };
}
