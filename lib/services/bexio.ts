/**
 * Bexio accounting API client.
 *
 * A dependency-free (fetch-only) client for the Bexio API that mirrors the
 * capability surface of the official bexio-mcp-server
 * (https://github.com/PromptPartner/bexio-mcp-server): contacts, invoices,
 * quotes, orders, accounting, banking, projects, timetracking, purchase,
 * payments, items, files and more.
 *
 * Credentials are NEVER hardcoded: the client reads its configuration from the
 * IntegrationSetting row (admin console) through `getIntegration("bexio")`.
 * When the connector is inactive/unconfigured, `getBexioSession` throws
 * `BexioNotConfiguredError` and every bexio_* MCP tool answers with a
 * structured `configured: false` result instead of failing.
 */

import { getIntegration, type IntegrationConfig } from "@/lib/integrations";

const BEXIO_API_BASE = "https://api.bexio.com/2.0";

export interface BexioSession {
  token: string;
}

/** Thrown when the Bexio connector has no usable credential configured. */
export class BexioNotConfiguredError extends Error {
  constructor(message = "Bexio is not configured — save the connector first.") {
    super(message);
    this.name = "BexioNotConfiguredError";
  }
}

/** Thrown on any non-2xx response from the Bexio API. */
export class BexioApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BexioApiError";
    this.status = status;
  }
}

/* ── configuration ──────────────────────────────────────────── */

/** Read the stored Bexio connector configuration (decrypted in-process). */
export async function getBexioConfig(): Promise<IntegrationConfig> {
  const { config } = await getIntegration("bexio");
  return config;
}

/* ── authentication ─────────────────────────────────────────── */

/**
 * Build an authenticated Bexio session for the stored connector configuration.
 * Throws {@link BexioNotConfiguredError} when no token is present.
 */
export async function getBexioSession(
  config: IntegrationConfig
): Promise<BexioSession> {
  const token = String(config.apiToken ?? "").trim();
  if (!token) {
    throw new BexioNotConfiguredError();
  }
  return { token };
}

/* ── transport ──────────────────────────────────────────────── */

async function request<T>(
  path: string,
  session: BexioSession,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BEXIO_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new BexioApiError(
      `Bexio API unreachable: ${
        err instanceof Error ? err.message : "network error"
      }`,
      0
    );
  }
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as T & {
    errors?: Array<{ message?: string }>;
    message?: string;
  };
  if (!res.ok) {
    const detail = body?.errors?.[0]?.message ?? body?.message;
    throw new BexioApiError(
      detail
        ? `Bexio responded ${res.status}: ${detail}`
        : `Bexio responded ${res.status}.`,
      res.status
    );
  }
  return body;
}

/** Make a request to a non-default API version (e.g. 3.0, 4.0). */
export async function requestVersioned<T>(
  version: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  endpoint: string,
  session: BexioSession,
  params?: Record<string, unknown>,
  data?: unknown
): Promise<T> {
  const url = `https://api.bexio.com/${version}/${endpoint}`;
  const qs = params
    ? `?${new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString()}`
    : "";
  let res: Response;
  try {
    res = await fetch(`${url}${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new BexioApiError(
      `Bexio API unreachable: ${
        err instanceof Error ? err.message : "network error"
      }`,
      0
    );
  }
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as T & {
    errors?: Array<{ message?: string }>;
    message?: string;
  };
  if (!res.ok) {
    const detail = body?.errors?.[0]?.message ?? body?.message;
    throw new BexioApiError(
      detail
        ? `Bexio responded ${res.status}: ${detail}`
        : `Bexio responded ${res.status}.`,
      res.status
    );
  }
  return body;
}

export function bexioGet<T>(path: string, session: BexioSession): Promise<T> {
  return request<T>(path, session);
}

export function bexioPost<T>(
  path: string,
  session: BexioSession,
  body: unknown
): Promise<T> {
  return request<T>(path, session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function bexioPut<T>(
  path: string,
  session: BexioSession,
  body: unknown
): Promise<T> {
  return request<T>(path, session, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function bexioPatch<T>(
  path: string,
  session: BexioSession,
  body: unknown
): Promise<T> {
  return request<T>(path, session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function bexioDelete(
  path: string,
  session: BexioSession
): Promise<void> {
  return request<void>(path, session, { method: "DELETE" });
}

/* ── probe (admin "Test connection") ────────────────────────── */

/**
 * Read-only connectivity check for the admin console. Proves the credential
 * is live by fetching the company profile — nothing is created or sent.
 */
export async function probeBexio(
  config: IntegrationConfig
): Promise<{ ok: boolean; detail: string }> {
  try {
    const session = await getBexioSession(config);
    const profile = await bexioGet<{ name?: string }>(
      "/company_profile",
      session
    );
    const name = Array.isArray(profile)
      ? (profile[0] as { name?: string })?.name
      : profile?.name;
    if (!name)
      return {
        ok: false,
        detail: "Authenticated, but Bexio returned no company profile.",
      };
    return { ok: true, detail: `Authenticated to Bexio as "${name}".` };
  } catch (err) {
    if (err instanceof BexioNotConfiguredError)
      return { ok: false, detail: err.message };
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "Bexio request failed.",
    };
  }
}
