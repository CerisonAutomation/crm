/**
 * Documenso e-signature client (E-SIGN slice; see docs/runbooks/esign-spec.md).
 *
 * Transport-agnostic on purpose: Documenso's upstream API surface could not be
 * verified from the build environment, so endpoint paths and event names are
 * explicit overridables defaulting to the public v1 conventions — VERIFY each
 * against the deployed Documenso version before going live. What IS fixed:
 * fail-closed behavior (unconfigured or erroring provider throws; nothing is
 * ever marked DOCUMENSO-signed without proof) and HMAC webhook verification.
 * Pure plus fetch injection — zero framework imports.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type DocumensoConfig = {
  baseUrl: string;
  apiKey: string;
  webhookSecret: string | null;
  createPath: string;
  signedEvents: string[];
};

export const DEFAULT_CREATE_PATH = "/api/documents";
export const DEFAULT_SIGNED_EVENTS = ["document.signed", "document.completed"];

/** Null when the provider is not fully configured (fail-closed downstream). */
export function documensoConfigFromEnv(env: Record<string, string | undefined> = process.env): DocumensoConfig | null {
  const baseUrl = env.DOCUMENSO_API_URL?.trim();
  const apiKey = env.DOCUMENSO_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    webhookSecret: env.DOCUMENSO_WEBHOOK_SECRET?.trim() || null,
    createPath: env.DOCUMENSO_CREATE_PATH?.trim() || DEFAULT_CREATE_PATH,
    signedEvents: parseSignedEvents(env.DOCUMENSO_SIGNED_EVENTS),
  };
}

function parseSignedEvents(raw: string | undefined): string[] {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_SIGNED_EVENTS];
}

export type EnvelopeRequest = {
  title: string;
  fileName: string;
  pdfBase64: string;
  recipientEmail?: string | null;
  metadata?: Record<string, string>;
};

export type EnvelopeResult = { envelopeId: string };

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const FETCH_TIMEOUT_MS = 15_000;

function defaultFetch(url: string, init: { method: string; headers: Record<string, string>; body: string }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal })
    .finally(() => clearTimeout(timer))
    .then((res) => ({ ok: res.ok, status: res.status, json: () => res.json() as Promise<unknown> }));
}

/** Create an envelope for the sealed PDF. Throws fail-closed on any doubt. */
export async function requestDocumensoEnvelope(
  config: DocumensoConfig,
  req: EnvelopeRequest,
  fetchFn: FetchFn = defaultFetch,
): Promise<EnvelopeResult> {
  let res;
  try {
    res = await fetchFn(config.baseUrl + config.createPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        title: req.title,
        document: { name: req.fileName, data: req.pdfBase64 },
        recipients: req.recipientEmail ? [{ email: req.recipientEmail }] : [],
        meta: req.metadata ?? {},
      }),
    });
  } catch (e) {
    throw new Error("Documenso envelope request failed: " + (e instanceof Error ? e.message : "network error"));
  }
  if (!res.ok) throw new Error("Documenso envelope request rejected (HTTP " + res.status + ")");
  const body = (await res.json().catch(() => null)) as { id?: unknown; documentId?: unknown } | null;
  const envelopeId = typeof body?.id === "string" ? body.id : typeof body?.documentId === "string" ? body.documentId : null;
  if (!envelopeId) throw new Error("Documenso envelope response carried no envelope id");
  return { envelopeId };
}

/** HMAC-SHA256 over the raw body; false on any doubt (missing secret counts). */
export function verifyDocumensoWebhook(secret: string | null | undefined, rawBody: string, signature: string | null | undefined): boolean {
  if (!secret || !signature) return false;
  const sig = signature.startsWith("hex:") ? signature.slice(4) : signature;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), "utf8");
    actual = Buffer.from(sig, "utf8");
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** True when the event name means "signed" under the configured mapping. */
export function isSignedEvent(config: Pick<DocumensoConfig, "signedEvents">, event: unknown): boolean {
  return typeof event === "string" && config.signedEvents.includes(event);
}
