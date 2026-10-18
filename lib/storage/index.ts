/**
 * Blob-storage port + adapters (server-only).
 *
 * Every vault read/write in the app goes through this module. Callers deal only
 * in opaque `vault://` keys (as persisted on Document.storageKey /
 * ApprovalLetter.storageKey); the physical layout is derived solely from the key.
 *
 * The driver is selected by STORAGE_DRIVER:
 *  - "local"  — filesystem under STORAGE_ROOT (dev / Docker).
 *  - "s3"     — S3-compatible object storage (AWS, MinIO, …). Needs
 *               AWS_ENDPOINT_URL_S3 + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY;
 *               bucket via S3_VAULT_BUCKET.
 *  - "vercel" — Vercel Blob storage (Vercel platform), private access only.
 *               Needs BLOB_READ_WRITE_TOKEN; store via BLOB_STORE_ID.
 *
 * Adding another driver later means one entry in DRIVERS — no caller changes.
 */
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { put, del, head, get as blobGet } from "@vercel/blob";
import { DomainError } from "@/lib/domain/states";

const KEY_PREFIX = "vault://";

/** A physical blob backend. Methods receive the validated relative object key. */
export type StorageDriver = {
  put(relKey: string, bytes: Buffer): Promise<void>;
  get(relKey: string): Promise<Buffer | null>;
  exists(relKey: string): Promise<boolean>;
  /** Best-effort removal — resolves even when the object is already gone. */
  delete(relKey: string): Promise<void>;
};

const localDriver: StorageDriver = {
  async put(relKey, bytes) {
    const abs = localPath(relKey);
    const parent = path.dirname(abs);
    await mkdir(/* turbopackIgnore: true */ parent, { recursive: true });
    await writeFile(/* turbopackIgnore: true */ abs, bytes);
  },
  async get(relKey) {
    const abs = localPath(relKey);
    try {
      return await readFile(/* turbopackIgnore: true */ abs);
    } catch {
      return null;
    }
  },
  async exists(relKey) {
    const abs = localPath(relKey);
    try {
      await stat(/* turbopackIgnore: true */ abs);
      return true;
    } catch {
      return false;
    }
  },
  async delete(relKey) {
    try {
      await rm(/* turbopackIgnore: true */ localPath(relKey), { force: true });
    } catch {
      // Best-effort: a missing object is already the desired end state.
    }
  },
};

/**
 * Storage root: STORAGE_ROOT override, else <cwd>/db/vault. Never hardcoded.
 *
 * The `turbopackIgnore` annotation is load-bearing: this path is resolved at
 * runtime and the tracer cannot bound it, so without the annotation it sweeps
 * the entire project into the standalone output.
 */
function storageRoot(): string {
  const explicit = process.env.STORAGE_ROOT?.trim();
  if (explicit) return explicit;
  return path.join(/* turbopackIgnore: true */ process.cwd(), "db", "vault");
}

/** Resolve a relative key under the root; rejects anything escaping it. */
function localPath(relKey: string): string {
  const root = path.resolve(/* turbopackIgnore: true */ storageRoot());
  const abs = path.resolve(/* turbopackIgnore: true */ root, relKey);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new DomainError("Storage key escapes the vault root", 422);
  }
  return abs;
}

let s3Client: S3Client | null = null;

function s3(): S3Client {
  if (s3Client) return s3Client;
  const endpoint = process.env.AWS_ENDPOINT_URL_S3?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new DomainError(
      "S3 storage is not configured (AWS_ENDPOINT_URL_S3 / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)",
      500,
    );
  }
  s3Client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return s3Client;
}

function s3Bucket(): string {
  return process.env.S3_VAULT_BUCKET?.trim() || "vault";
}

const s3Driver: StorageDriver = {
  async put(relKey, bytes) {
    await s3().send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: relKey,
        Body: bytes,
        ContentType: "application/octet-stream",
      }),
    );
  },
  async get(relKey) {
    try {
      const res = await s3().send(
        new GetObjectCommand({ Bucket: s3Bucket(), Key: relKey }),
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch {
      return null;
    }
  },
  async exists(relKey) {
    try {
      await s3().send(
        new HeadObjectCommand({ Bucket: s3Bucket(), Key: relKey }),
      );
      return true;
    } catch {
      return false;
    }
  },
  async delete(relKey) {
    try {
      await s3().send(
        new DeleteObjectCommand({ Bucket: s3Bucket(), Key: relKey }),
      );
    } catch {
      // Best-effort (S3 deletes are idempotent; a missing key still resolves).
    }
  },
};

const vercelDriver: StorageDriver = {
  async put(relKey, bytes) {
    // Private access: the vault holds passports, national IDs and recordings.
    // Every read goes through storageGet(), so the object URL never reaches a
    // browser and public access would only widen the exposure.
    //
    // OIDC takes precedence when VERCEL_OIDC_TOKEN is present (the SDK resolves
    // it automatically from the environment), so we only pass the static token
    // when it is explicitly set. Passing a token explicitly always wins over
    // OIDC, so we must NOT pass undefined — the SDK treats an explicit
    // undefined token as "no token" and falls back to OIDC.
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    await put(relKey, bytes, {
      access: "private",
      ...(token ? { token } : {}),
      addRandomSuffix: false,
    });
  },
  async get(relKey) {
    try {
      // Read through the SDK: it resolves the store from BLOB_STORE_ID and
      // authorises the fetch, which the required `access` selects.
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      const res = await blobGet(relKey, {
        access: "private",
        ...(token ? { token } : {}),
      });
      if (!res?.stream) return null;
      const reader = res.stream.getReader();
      const chunks: Buffer[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  },
  async exists(relKey) {
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      const res = await head(relKey, { ...(token ? { token } : {}) });
      return res !== null;
    } catch {
      return false;
    }
  },
  async delete(relKey) {
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      await del(relKey, { ...(token ? { token } : {}) });
    } catch {
      // Best-effort: a missing blob is already the desired end state.
    }
  },
};

const DRIVERS: Record<string, StorageDriver> = {
  local: localDriver,
  s3: s3Driver,
  vercel: vercelDriver,
};

/**
 * Which driver to use.
 *
 * `STORAGE_DRIVER` wins when set. Otherwise the host decides: a serverless
 * filesystem is ephemeral, so defaulting to `local` there would accept every
 * upload and silently discard it at the next cold start. Vercel Blob is
 * therefore the default on serverless hosts — the failure mode then is an
 * explicit, diagnosable "not configured" error rather than quiet data loss.
 * Self-hosted / Docker deployments keep the local filesystem default.
 */
function driverName(): string {
  const explicit = process.env.STORAGE_DRIVER?.trim();
  if (explicit) return explicit;
  const serverless = Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY,
  );
  return serverless ? "vercel" : "local";
}

function driver(): StorageDriver {
  const name = driverName();
  const selected = DRIVERS[name];
  if (!selected) throw new DomainError(`Unknown storage driver "${name}"`, 422);
  return selected;
}

/** The active driver's name — surfaced by /api/health and the admin console. */
export function activeStorageDriver(): string {
  return driverName();
}

/**
 * The drivers this build actually implements. Exported so the deployment
 * readiness report can import it instead of duplicating the list.
 */
export const KNOWN_STORAGE_DRIVERS: readonly string[] = ["local", "s3", "vercel"];

/**
 * Validate a `vault://…` key and return the relative object path.
 * Rejects absolute keys and any `..`/`.` segment (defence in depth — the
 * local driver additionally re-checks containment against the root).
 */
function resolveKey(storageKey: string): string {
  if (typeof storageKey !== "string" || !storageKey.startsWith(KEY_PREFIX)) {
    throw new DomainError("Invalid storage key", 422);
  }
  const rel = storageKey.slice(KEY_PREFIX.length).replace(/\\/g, "/");
  if (!rel || rel.startsWith("/")) throw new DomainError("Invalid storage key", 422);
  const segments = rel.split("/").filter((seg) => seg.length > 0);
  if (segments.length === 0 || segments.some((seg) => seg === ".." || seg === ".")) {
    throw new DomainError("Invalid storage key", 422);
  }
  return segments.join("/");
}

/** Persist bytes for a `vault://` key (parent directories are created lazily). */
export async function storagePut(storageKey: string, bytes: Buffer): Promise<void> {
  await driver().put(resolveKey(storageKey), bytes);
}

/** Read bytes for a `vault://` key, or null when the blob does not exist. */
export async function storageGet(storageKey: string): Promise<Buffer | null> {
  return driver().get(resolveKey(storageKey));
}

/** Whether a blob exists for a `vault://` key. */
export async function storageExists(storageKey: string): Promise<boolean> {
  return driver().exists(resolveKey(storageKey));
}

/**
 * Preserve-then-overwrite write (RES annex: object versioning without a versioned bucket).
 *
 * When a blob already exists, its bytes are copied to `_versions/<rel>@<utc>`
 * before the new bytes land, so no vault write ever destroys the prior copy.
 * Works on every driver (local/s3/vercel) because it only uses put/get/exists.
 * Version rows accumulate with the case file; curating them is an authorised
 * disposition step, never the housekeeping timer.
 */
export function versionedRelKey(relKey: string, at = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  return '_versions/' + relKey + '@' + stamp;
}

/** Best-effort removal for a `vault://` key — resolves even when already gone. */
export async function storageDelete(storageKey: string): Promise<void> {
  await driver().delete(resolveKey(storageKey));
}

export async function storagePutWithHistory(storageKey: string, bytes: Buffer): Promise<{ versioned: boolean }> {
  const rel = resolveKey(storageKey);
  const d = driver();
  if (await d.exists(rel)) {
    const prior = await d.get(rel);
    if (prior) await d.put(versionedRelKey(rel), prior);
    await d.put(rel, bytes);
    return { versioned: true };
  }
  await d.put(rel, bytes);
  return { versioned: false };
}

