/**
 * Server-only, validated environment configuration.
 *
 * Single typed source for the server env vars the app reads. Values are parsed
 * INDIVIDUALLY, so one malformed value can never discard the others (a typo in
 * `OCR_ENGINE` cannot blank `AUTH_SECRET`). Empty strings are treated as unset.
 * Any key whose provided value was rejected — and therefore fell back to its
 * default — is named in a startup warning.
 *
 * Server-only: never import this from a `"use client"` module.
 */
import { z } from "zod";

const DEFAULT_VAPID_SUBJECT = "mailto:platform@citizen-lane.com";

/** Strict (catch-free) validators — a failed parse here is exactly what "fell back" means. */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),
  CRON_SECRET: z.string().optional(),
  AUTH_SECRET: z.string().min(1).optional(),

  INTERNAL_AUTOMATION_TOKEN: z.string(),
  APP_INTERNAL_BASE: z.string().min(1),

  INTEGRATION_WEBHOOK_SECRET: z.string().optional(),
    LANE_INTERNAL_SECRET: z.string().optional(),
    INTEGRATION_SECRET_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1),
    VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),

  STORAGE_ROOT: z.string().optional(),
  STORAGE_DRIVER: z.string().min(1),
  OCR_ENGINE: z.string().min(1),

  // S3-compatible object storage (optional — only when STORAGE_DRIVER=s3)
  AWS_ENDPOINT_URL_S3: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_VAULT_BUCKET: z.string().optional(),

  // Neon AI Gateway (optional)
  NEON_AI_GATEWAY_TOKEN: z.string().optional(),

  // Vercel Blob storage (optional — only when STORAGE_DRIVER=vercel)
  BLOB_STORE_ID: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // WebRTC TURN relay — SERVER-ONLY (never NEXT_PUBLIC_*, which would leak the
  // credential into the client bundle). TURN_STATIC_SECRET enables the coturn
  // REST API: the server mints short-lived per-user credentials on demand.
  TURN_URL: z.string().optional(),
  TURN_STATIC_SECRET: z.string().optional(),
  TURN_USER: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Effective value when a key is absent or rejected (matches the prior runtime defaults). */
const FALLBACKS: Record<keyof Env, string | undefined> = {
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  CRON_SECRET: undefined,
  AUTH_SECRET: undefined,
  INTERNAL_AUTOMATION_TOKEN: "",
  APP_INTERNAL_BASE: "http://127.0.0.1:3000",
  INTEGRATION_WEBHOOK_SECRET: undefined,
    LANE_INTERNAL_SECRET: undefined,
    INTEGRATION_SECRET_KEY: undefined,
    VAPID_SUBJECT: DEFAULT_VAPID_SUBJECT,
    VAPID_PUBLIC_KEY: undefined,
  VAPID_PRIVATE_KEY: undefined,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined,
  STORAGE_ROOT: undefined,
  STORAGE_DRIVER: "local",
  OCR_ENGINE: "vlm",

  AWS_ENDPOINT_URL_S3: undefined,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  AWS_REGION: undefined,
  S3_VAULT_BUCKET: undefined,
  NEON_AI_GATEWAY_TOKEN: undefined,

  BLOB_STORE_ID: undefined,
  BLOB_READ_WRITE_TOKEN: undefined,

  TURN_URL: undefined,
  TURN_STATIC_SECRET: undefined,
  TURN_USER: undefined,
  TURN_CREDENTIAL: undefined,
};

/** `process.env` with empty strings normalised to unset. */
const rawEnv: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

function loadEnv(): Env {
  const out: Record<string, unknown> = {};
  const fellBack: string[] = [];

  for (const key of Object.keys(envSchema.shape) as (keyof Env)[]) {
    const raw = rawEnv[key as string];
    const parsed = envSchema.shape[key].safeParse(raw);
    if (parsed.success) {
      out[key] = parsed.data;
    } else {
      out[key] = FALLBACKS[key];
      // Report a genuine misconfiguration only: a NON-EMPTY provided value that
      // was rejected. Empty/absent legitimately means "use the default".
      if (typeof raw === "string" && raw.length > 0) fellBack.push(key as string);
    }
  }

  if (fellBack.length > 0) {
    console.warn(`[env] invalid value(s) fell back to defaults: ${fellBack.join(", ")}`);
  }
  return out as Env;
}

export const env: Env = loadEnv();
