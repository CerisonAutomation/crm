/**
 * Integration layer — admin-configurable, keyless-by-default connectors.
 *
 * Credentials are NEVER hardcoded: every integration reads its configuration
 * from the IntegrationSetting table (configured by an Administrator in the
 * console). When an integration is not configured/active, deliveries fall
 * back to the OutboxEvent ledger (observable, replayable) — the platform
 * never throws because SMTP/WhatsApp is missing in a sandbox.
 */
import { db } from "@/lib/db";
import nodemailer from "nodemailer";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertPublicWebhookTarget } from "@/lib/integrations/webhooks";

export type IntegrationKey = "smtp" | "resend" | "whatsapp" | "webhook" | "dhl" | "ai" | "automation" | "n8n" | "xero" | "bexio" | "github";

export type IntegrationConfig = Record<string, unknown>;

/**
 * Canonical, exhaustive list of configurable connectors, in display order.
 * The API route and the admin console both read this list — it is the single
 * source of truth for "which connectors exist", so a connector added here is
 * immediately configurable in the UI (no second hardcoded list to forget).
 */
export const INTEGRATION_ORDER: readonly IntegrationKey[] = [
  "smtp",
  "resend",
  "whatsapp",
  "webhook",
  "dhl",
  "ai",
  "automation",
  "n8n",
  "xero",
  "bexio",
  "github",
] as const;

/** Prisma `IntegrationSetting.kind` for a connector (server-side only). */
export function integrationKind(key: IntegrationKey): string {
  switch (key) {
    case "smtp":
      return "EMAIL";
    case "resend":
      return "EMAIL";
    case "whatsapp":
      return "WHATSAPP";
    case "ai":
      return "AI";
    case "dhl":
      return "SHIPPING";
    case "automation":
          return "AUTOMATION";
        case "webhook":
          return "WEBHOOK";
        case "n8n":
          return "N8N";
        case "xero":
        case "bexio":
          return "ACCOUNTING";
        case "github":
          return "GITHUB";
        default:
          return "WEBHOOK";
      }
    }

type CacheEntry = { config: IntegrationConfig; active: boolean; at: number };
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();

export const INTEGRATION_LABELS: Record<IntegrationKey, string> = {
  smtp: "Email (SMTP)",
  resend: "Resend transactional email",
  whatsapp: "WhatsApp",
  webhook: "Outbound Webhook",
  ai: "AI Provider",
  dhl: "DHL Express (MyDHL API)",
  automation: "Automation engine (in-app)",
  n8n: "n8n (external, optional)",
  xero: "Xero (accounting)",
  bexio: "Bexio (accounting)",
  github: "GitHub (repository)",
};

/**
 * One-line "what this connector is for" copy, shown under each card title.
 * Returned by the API alongside `INTEGRATION_FIELDS` (both are server-authored
 * English, exactly like the field `help` strings) so an administrator can tell
 * what a connector does — and what breaks without it — before enabling it.
 */
export const INTEGRATION_BLURBS: Record<IntegrationKey, string> = {
  smtp: "Transactional email — documents, notifications, magic links. When inactive, every message is written to the automation ledger instead, so nothing is lost.",
  resend: "Transactional email through Resend's API with provider delivery events. Use this for managed delivery; SMTP remains available as the self-hosted fallback.",
  whatsapp: "Client messaging through the Meta WhatsApp Cloud API, or any gateway that accepts a POST { to, message } webhook.",
  webhook: "Fallback target for outbound workflow nodes that leave their URL empty.",
  dhl: "Real DHL Express label creation and tracking via the MyDHL API (test or production). Without it, dispatch nodes use the sandbox adapter — a deterministic placeholder tracking number is recorded and no real shipment or label is bought.",
  ai: "Advisory model hint for the in-app AI. The platform's sandbox provider is keyless — no credential is required.",
  automation: "The self-contained in-app engine: dispatch capacity, batch size and a global pause switch. No external service is needed for automation to work.",
  n8n: "External n8n workflow automation sink. When active, outbound workflow nodes fan out to the configured n8n instance over its API; when inactive, events stay in the in-app ledger. Optional — the platform runs perfectly without it.",
  xero: "Xero accounting — contacts, invoices, payments, quotes, credit notes, items, bank transactions, manual journals, tracking categories, tax rates and payroll. Exposed as MCP tools (xero_*) so any MCP client can drive the ledger through the platform. When inactive, every xero_* tool returns a structured not-configured result instead of failing.",
  bexio: "Bexio accounting — contacts, invoices, quotes, orders, banking, projects, timetracking, purchase, payments, items and files. Exposed as MCP tools (bexio_*) so any MCP client can drive the ledger through the platform. When inactive, every bexio_* tool returns a structured not-configured result instead of failing.",
  github: "GitHub — repositories, issues, pull requests, commits, files and search. Exposed as MCP tools (github_*) so any MCP client can drive the repository through the platform. When inactive, every github_* tool returns a structured not-configured result instead of failing.",
  };

/** Read an integration setting (15s in-memory cache to keep runs fast). */
export async function getIntegration(key: IntegrationKey): Promise<{ active: boolean; config: IntegrationConfig }> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { active: hit.active, config: hit.config };
  const row = await db.integrationSetting.findUnique({ where: { key } });
  const entry: CacheEntry = {
    active: row?.active ?? false,
    config: row ? openConfig(safeParse(row.config) as IntegrationConfig) : {},
    at: Date.now(),
  };
  cache.set(key, entry);
  return entry;
}

function safeParse(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ─────────────────────────── secret encryption at rest ───────────────────────────
//
// Connector credentials (SMTP password, WhatsApp token, …) are encrypted with
// AES-256-GCM before they are persisted, so a database dump or backup never
// exposes live secrets. The key is taken from INTEGRATION_SECRET_KEY (preferred)
// or AUTH_SECRET; when neither is configured, a key is generated once and kept
// in a file OUTSIDE the database (INTEGRATION_KEY_FILE, default
// <cwd>/.integration-secrets/key) so encryption is still effective by default.
// Legacy plaintext rows keep working — decryption is only attempted on values
// carrying the `enc:v1:` prefix.

const ENC_PREFIX = "enc:v1:";
const isSecretField = (key: string) => /pass|secret|token|key|auth/i.test(key);

let cachedKey: Buffer | null | undefined;
/**
 * Path of the generated encryption key (durable filesystems only).
 *
 * `turbopackIgnore` keeps the runtime-resolved path out of the build's file
 * trace — without it the tracer cannot bound this path and includes the whole
 * project in the standalone output.
 */
function keyFilePath(): string {
  const explicit = process.env.INTEGRATION_KEY_FILE?.trim();
  if (explicit) return explicit;
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".integration-secrets", "key");
}

/**
 * True on a serverless host where the filesystem is ephemeral and (outside /tmp)
 * read-only. Generating-and-persisting a key there would be worse than useless:
 * the file vanishes at the next cold start, so every secret written under it
 * becomes permanently undecryptable. Detected rather than inferred from
 * NODE_ENV, because a self-hosted production build has a durable disk.
 */
function ephemeralFilesystem(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

function encryptionKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = (process.env.INTEGRATION_SECRET_KEY ?? process.env.AUTH_SECRET)?.trim();
  if (raw) {
    cachedKey = createHash("sha256").update(raw).digest(); // stable 32-byte key
    return cachedKey;
  }
  if (ephemeralFilesystem()) {
    console.warn(
      "[integrations] INTEGRATION_SECRET_KEY / AUTH_SECRET is not set on this serverless host. " +
        "Connector secrets will NOT be encrypted at rest. Set INTEGRATION_SECRET_KEY to enable encryption.",
    );
    cachedKey = null;
    return null;
  }
  // Durable filesystem (self-hosted / Docker): persist a generated key in a file
  // outside the database, so a DB dump alone cannot decrypt the stored secrets.
  const file = keyFilePath();
  try {
    if (existsSync(/* turbopackIgnore: true */ file)) {
      const hex = readFileSync(/* turbopackIgnore: true */ file, "utf8").trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        cachedKey = Buffer.from(hex, "hex");
        return cachedKey;
      }
    }
    const generated = randomBytes(32);
    const parent = path.dirname(file);
    mkdirSync(/* turbopackIgnore: true */ parent, { recursive: true });
    writeFileSync(/* turbopackIgnore: true */ file, generated.toString("hex"), { mode: 0o600 });
    cachedKey = generated;
    return cachedKey;
  } catch (err) {
    console.warn("[integrations] could not persist an encryption key — connector secrets stored unencrypted:", (err as Error).message);
    cachedKey = null;
    return null;
  }
}

function encryptValue(plain: string, key: Buffer): string {
  if (plain.startsWith(ENC_PREFIX)) return plain; // already sealed — idempotent
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

function decryptValue(stored: string, key: Buffer | null): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext
  if (!key) return ""; // no key to decrypt with — never surface ciphertext
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    console.error("[integrations] failed to decrypt a stored secret — value dropped");
    return "";
  }
}

/**
 * Seal one free-form secret with the integration key (AES-256-GCM, enc:v1:).
 * Shared by per-user secrets (e.g. MFA TOTP) so every secret uses one format
 * and one rotation story. Returns null when no key is configured — callers
 * must fail closed instead of persisting plaintext.
 */
export function sealSecret(plain: string): string | null {
  const key = encryptionKey();
  if (!key) return null;
  return encryptValue(plain, key);
}

/** Open a sealed secret. Returns "" when undecryptable — never ciphertext. */
export function openSecret(sealed: string): string {
  return decryptValue(sealed, encryptionKey());
}

/** Encrypt every secret-named string field before persisting. */
function sealConfig(config: IntegrationConfig): IntegrationConfig {
  const key = encryptionKey();
  if (!key) return config;
  const out: IntegrationConfig = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = typeof v === "string" && isSecretField(k) ? encryptValue(v, key) : v;
  }
  return out;
}

/** Decrypt secret-named fields read back from storage. */
function openConfig(config: IntegrationConfig): IntegrationConfig {
  const key = encryptionKey();
  const out: IntegrationConfig = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = typeof v === "string" && isSecretField(k) ? decryptValue(v, key) : v;
  }
  return out;
}

export function invalidateIntegrationCache(key?: IntegrationKey) {
  if (key) cache.delete(key);
  else cache.clear();
}

/** Upsert an integration configuration (admin console). */
export async function setIntegration(key: IntegrationKey, config: IntegrationConfig, active: boolean, updatedBy?: string) {
  const kind = integrationKind(key);
  await db.integrationSetting.upsert({
    where: { key },
    update: { config: JSON.stringify(sealConfig(config)), active, updatedBy: updatedBy ?? null, kind },
    create: { key, kind, label: INTEGRATION_LABELS[key], config: JSON.stringify(sealConfig(config)), active, updatedBy: updatedBy ?? null },
  });
  invalidateIntegrationCache(key);
}

/** Mask secrets before returning config to the client. */
export function maskConfig(config: IntegrationConfig): IntegrationConfig {
  const out: IntegrationConfig = {};
  for (const [k, v] of Object.entries(config)) {
    // Reveal nothing of a stored secret — the fixed mask still contains "•••"
    // so the admin UI treats it as "unchanged" on save (and never leaks a value).
    if (isSecretField(k) && typeof v === "string" && v.length > 0) {
      out[k] = "••••••••";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─────────────────────────── Email ───────────────────────────

export type EmailInput = { to: string; subject: string; body: string };

export type DeliveryOutcome = {
  delivered: boolean;
  channel: "smtp" | "resend" | "ledger" | "whatsapp-api" | "whatsapp-webhook" | "http";
  detail: string;
};

export async function sendEmail(input: EmailInput): Promise<DeliveryOutcome> {
  const resend = await getIntegration("resend");
  if (resend.active && resend.config.apiKey && resend.config.from) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${String(resend.config.apiKey)}`,
        },
        body: JSON.stringify({
          from: String(resend.config.from),
          to: [input.to],
          subject: input.subject,
          text: input.body,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
      if (response.ok) return { delivered: true, channel: "resend", detail: `accepted (${payload.id ?? "provider receipt"})` };
      const detail = payload.message ?? `Resend responded ${response.status}`;
      await ledgerEmail(input, detail);
      return { delivered: false, channel: "resend", detail };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "resend error";
      await ledgerEmail(input, detail);
      return { delivered: false, channel: "resend", detail };
    } finally {
      clearTimeout(timer);
    }
  }
  const { active, config } = await getIntegration("smtp");
  if (active && config.host) {
    try {
      const transport = nodemailer.createTransport({
        host: String(config.host),
        port: Number(config.port ?? 587),
        secure: Boolean(config.secure ?? false),
        auth: config.user ? { user: String(config.user), pass: String(config.pass ?? "") } : undefined,
      });
      const info = await transport.sendMail({
        from: `"${String(config.fromName ?? "Citizen Lane")}" <${String(config.from ?? config.user ?? "no-reply@citizenlane.ch")}>`,
        to: input.to,
        subject: input.subject,
        text: input.body,
      });
      return { delivered: true, channel: "smtp", detail: `accepted (${info.messageId})` };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "smtp error";
      await ledgerEmail(input, detail);
      return { delivered: false, channel: "smtp", detail };
    }
  }
  await ledgerEmail(input, "SMTP not configured — recorded in automation ledger");
  return { delivered: true, channel: "ledger", detail: "queued to ledger (no SMTP configured)" };
}

async function ledgerEmail(input: EmailInput, detail: string): Promise<boolean> {
  await db.outboxEvent
    .create({
      data: {
        topic: "email.delivered",
        payload: JSON.stringify({ to: input.to, subject: input.subject, preview: input.body.slice(0, 160), note: detail, channel: "EMAIL" }),
        status: "PROCESSED",
        processedAt: new Date(),
      },
    })
    .catch(() => undefined);
  return true;
}

// ─────────────────────────── WhatsApp ───────────────────────────

export type WhatsAppInput = { toPhone: string; message: string };

/**
 * Meta WhatsApp Cloud API origin — a compile-time CONSTANT, never derived from
 * admin input. Only the numeric phone-number id is interpolated (percent-
 * encoded) into the path, so there is no host-injection / SSRF surface on this
 * transport. The admin-configurable `webhook` transport, by contrast, is
 * validated through the shared outbound-url guard before every request.
 */
const WHATSAPP_CLOUD_API_ORIGIN = "https://graph.facebook.com";

/**
 * WhatsApp delivery. Two admin-configurable transports:
 *  - provider "cloud_api": Meta WhatsApp Cloud API (phoneNumberId + token)
 *  - provider "webhook": any gateway that accepts POST { to, message }
 * Without configuration the message is recorded in the automation ledger.
 */
export async function sendWhatsApp(input: WhatsAppInput): Promise<DeliveryOutcome> {
  const { active, config } = await getIntegration("whatsapp");
  const provider = String(config.provider ?? "cloud_api");
  if (active && provider === "cloud_api" && config.phoneNumberId && config.token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // Host pinned to WHATSAPP_CLOUD_API_ORIGIN; the id is percent-encoded so it
      // cannot break out of its path segment into another host/path/query.
      const res = await fetch(`${WHATSAPP_CLOUD_API_ORIGIN}/v20.0/${encodeURIComponent(String(config.phoneNumberId))}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(config.token)}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: input.toPhone, type: "text", text: { body: input.message } }),
        signal: controller.signal,
      });
      return { delivered: res.ok, channel: "whatsapp-api", detail: res.ok ? "accepted by Cloud API" : `Cloud API responded ${res.status}` };
    } catch (err) {
      return { delivered: false, channel: "whatsapp-api", detail: err instanceof Error ? err.message : "cloud api error" };
    } finally {
      clearTimeout(timer);
    }
  }
  if (active && provider === "webhook" && typeof config.url === "string" && config.url) {
    // Same SSRF guard as the outbound webhook deliverer: this URL is stored in
    // the DB and set from the admin console, so it is treated as untrusted and
    // validated (http/https, public host, standard port, DNS not private)
    // before we POST to it. A destination that fails the guard is refused
    // outright — no request is made.
    const guard = await assertPublicWebhookTarget(String(config.url));
    if (!guard.ok) {
      return { delivered: false, channel: "whatsapp-webhook", detail: guard.error };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(String(config.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.token ? { Authorization: `Bearer ${String(config.token)}` } : {}),
        },
        body: JSON.stringify({ to: input.toPhone, message: input.message }),
        signal: controller.signal,
      });
      return { delivered: res.ok, channel: "whatsapp-webhook", detail: res.ok ? "webhook accepted" : `webhook responded ${res.status}` };
    } catch (err) {
      return { delivered: false, channel: "whatsapp-webhook", detail: err instanceof Error ? err.message : "webhook error" };
    } finally {
      clearTimeout(timer);
    }
  }
  await db.outboxEvent
    .create({
      data: {
        topic: "whatsapp.delivered",
        payload: JSON.stringify({ to: input.toPhone, preview: input.message.slice(0, 160), note: "WhatsApp provider not configured — recorded in automation ledger", channel: "WHATSAPP" }),
        status: "PROCESSED",
        processedAt: new Date(),
      },
    })
    .catch(() => undefined);
  return { delivered: true, channel: "ledger", detail: "queued to ledger (no WhatsApp provider configured)" };
}

// ─────────────────────────── UI metadata ───────────────────────────

/** Config keys exposed per integration — drives the admin settings UI. */
export const INTEGRATION_FIELDS: Record<IntegrationKey, Array<{ key: string; label: string; type: "text" | "password" | "number" | "select"; options?: string[]; required?: boolean; help?: string }>> = {
  smtp: [
    { key: "host", label: "SMTP host", type: "text", required: true, help: "e.g. smtp.protonmail.ch" },
    { key: "port", label: "Port", type: "number", required: true },
    { key: "secure", label: "Use TLS (port 465)", type: "select", options: ["true", "false"] },
    { key: "user", label: "Username", type: "text" },
    { key: "pass", label: "Password", type: "password" },
    { key: "from", label: "From address", type: "text", help: "e.g. info@citizen-lane.com" },
    { key: "fromName", label: "From name", type: "text" },
  ],
  resend: [
    { key: "apiKey", label: "Resend API key", type: "password", required: true, help: "Stored encrypted and used only server-side for transactional sends." },
    { key: "from", label: "Verified from address", type: "text", required: true, help: "A sender/domain verified in Resend." },
  ],
  whatsapp: [
    { key: "provider", label: "Transport", type: "select", options: ["cloud_api", "webhook"], required: true, help: "Meta Cloud API or any webhook gateway" },
    { key: "phoneNumberId", label: "Phone number ID", type: "text" },
    { key: "token", label: "Access token", type: "password" },
    { key: "url", label: "Webhook URL", type: "text", help: "Only for the webhook transport" },
  ],
  webhook: [
    { key: "url", label: "Default webhook URL", type: "text", help: "Fallback when a workflow node leaves the URL empty" },
  ],
  ai: [
      { key: "model", label: "Model hint", type: "text", help: "Sandbox AI is keyless; the hint is advisory only" },
    ],
    dhl: [
      { key: "accountNumber", label: "DHL Express Account Number", type: "text", required: true, help: "Your 10-digit DHL Express account number" },
      { key: "username", label: "API Key", type: "text", required: true, help: "MyDHL API Key from your developer.dhl.com app — sent as the Basic-auth username (per DHL docs, Authorization: Basic only).", },
      { key: "password", label: "API Secret", type: "password", required: true, help: "MyDHL API Secret — sent as the Basic-auth password." },
      { key: "environment", label: "Environment", type: "select", options: ["test", "production"], required: true, help: "Use 'test' for sandbox development" },
      { key: "defaultProduct", label: "Default Product", type: "select", options: ["P", "B", "E", "D", "V", "X"], help: "DHL Express product code (P=DHL Express Worldwide, B=DHL Express 12:00, E=DHL Express 9:00, D=DHL Domestic, V=DHL Economy Select, X=DHL Express Easy)" },
      { key: "webhookSecret", label: "Tracking webhook secret", type: "password", help: "Shared secret DHL signs tracking callbacks with (HMAC-SHA256). Leave empty to fail closed — the tracking webhook rejects unsigned requests." },
      { key: "declaredValue", label: "Declared value (CHF)", type: "number", help: "Customs declared value used on document shipments. Defaults to 100 when empty." },
    ],
    automation: [
          { key: "maxConcurrent", label: "Max concurrent runs", type: "number", help: "Capacity governor: how many automation jobs may run at once platform-wide. 0 = no cap. Default 8." },
          { key: "batchSize", label: "Batch size per cycle", type: "number", help: "Maximum jobs claimed per dispatch cycle (every 60s). Default 10." },
          { key: "paused", label: "Pause dispatch", type: "select", options: ["false", "true"], help: "Pause the whole automation queue without losing queued work. Reset to 'false' to resume." },
        ],
        n8n: [
          { key: "baseUrl", label: "n8n base URL", type: "text", required: true, help: "e.g. https://n8n.example.com — the self-hosted n8n instance. Leave this connector inactive to run in-app only." },
          { key: "apiKey", label: "n8n API key", type: "password", help: "Optional. n8n ≥1.0 requires an API key for /api/v1; if absent the probe hits /healthz instead." },
          { key: "workflowId", label: "Default workflow ID", type: "text", help: "Optional. Workflow to trigger when an outbound node fans out to n8n." },
        ],
        xero: [
          { key: "authMode", label: "Authentication mode", type: "select", options: ["custom_connection", "bearer_token"], required: true, help: "Custom Connection exchanges clientId/clientSecret for a token (recommended for a single organisation). Bearer token accepts a pre-issued token and resolves the tenant at runtime — use it to support multiple Xero organisations." },
          { key: "clientId", label: "Client ID", type: "text", help: "Xero app client ID (Custom Connection mode)." },
          { key: "clientSecret", label: "Client Secret", type: "password", help: "Xero app client secret (Custom Connection mode). Stored encrypted, never returned raw." },
          { key: "bearerToken", label: "Bearer token", type: "password", help: "Pre-issued access token (Bearer token mode). Takes precedence over clientId/clientSecret when set." },
          { key: "tenantId", label: "Tenant ID", type: "text", help: "Optional. Pin a specific Xero tenant (tenantId). Leave empty to use the first connection returned by Xero." },
          { key: "scopes", label: "Scopes", type: "text", help: "Optional space-separated scope override. Defaults to the bundled V1 scopes, falling back to the granular V2 scopes on an invalid_scope error." },
          { key: "payrollRegion", label: "Payroll region", type: "select", options: ["AU", "NZ", "UK"], help: "Payroll endpoints are region-specific. Payroll tools require the organisation's region to be NZ or UK." },
          { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"], help: "Xero sandbox tenant for safe testing. Production is the default." },
        ],
        bexio: [
          { key: "apiToken", label: "API token", type: "password", required: true, help: "Bexio personal API token (Bexio → Settings → API). Stored encrypted, never returned raw." },
        ],
        github: [
          { key: "personalAccessToken", label: "Personal access token", type: "password", required: true, help: "GitHub personal access token (fine-grained, minimal scopes). Stored encrypted, never returned raw." },
          { key: "apiBaseUrl", label: "API base URL", type: "text", help: "Optional GitHub API base URL override (defaults to https://api.github.com)." },
        ],
      };
