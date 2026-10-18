/**
 * Xero accounting API client.
 *
 * A dependency-free (fetch-only) client for the Xero API that mirrors the
 * capability surface of the official Xero MCP server
 * (https://github.com/XeroAPI/xero-mcp-server): contacts, invoices, payments,
 * quotes, credit notes, items, bank transactions, manual journals, tracking
 * categories, tax rates, reports and payroll.
 *
 * Two authentication modes are supported, matching the upstream server:
 *   • Custom Connection — exchanges clientId/clientSecret for an access token
 *     via `grant_type=client_credentials` (recommended for one organisation).
 *   • Bearer token — accepts a pre-issued token and resolves the tenant at
 *     runtime, so a single credential can address multiple organisations.
 *
 * Credentials are NEVER hardcoded: the client reads its configuration from the
 * IntegrationSetting row (admin console) through `getIntegration("xero")`.
 * When the connector is inactive/unconfigured, `getXeroSession` throws
 * `XeroNotConfiguredError` and every xero_* MCP tool answers with a structured
 * `configured: false` result instead of failing — the platform never breaks
 * because an external provider is missing in a sandbox.
 */

import { getIntegration, type IntegrationConfig } from "@/lib/integrations";

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

/**
 * Legacy bundled scopes (deprecated but still accepted for apps created
 * before the granular-scope cutover). The upstream server tries these first.
 */
const SCOPES_V1 = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "accounting.reports.read",
  "payroll.settings",
  "payroll.employees",
  "payroll.timesheets",
].join(" ");

/**
 * Granular scopes required for newer Xero apps. Used as the fallback when the
 * V1 bundle is rejected with `invalid_scope`.
 */
const SCOPES_V2 = [
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.contacts",
  "accounting.settings",
  "payroll.settings",
  "payroll.employees",
  "payroll.timesheets",
].join(" ");

/** Xero access tokens are valid for 30 minutes; refresh a little early. */
const TOKEN_TTL_MS = 25 * 60 * 1000;

export interface XeroSession {
  token: string;
  tenantId: string;
}

/** Thrown when the Xero connector has no usable credential configured. */
export class XeroNotConfiguredError extends Error {
  constructor(message = "Xero is not configured — save the connector first.") {
    super(message);
    this.name = "XeroNotConfiguredError";
  }
}

/** Thrown on any non-2xx response from the Xero API or identity service. */
export class XeroApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "XeroApiError";
    this.status = status;
    this.code = code;
  }
}

/* ── configuration ──────────────────────────────────────────── */

/** Read the stored Xero connector configuration (decrypted in-process). */
export async function getXeroConfig(): Promise<IntegrationConfig> {
  const { config } = await getIntegration("xero");
  return config;
}

/* ── authentication ─────────────────────────────────────────── */

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

/** In-process token cache, keyed by credential identity. */
const tokenCache = new Map<string, TokenCacheEntry>();

function cacheKey(config: IntegrationConfig): string {
  const bearer = String(config.bearerToken ?? "").trim();
  if (bearer) return `bearer:${bearer}`;
  return `cc:${String(config.clientId ?? "").trim()}`;
}

/** Exchange client credentials for an access token. */
async function requestToken(
  clientId: string,
  clientSecret: string,
  scope: string
): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );
  let res: Response;
  try {
    res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new XeroApiError(
      `Xero identity service unreachable: ${
        err instanceof Error ? err.message : "network error"
      }`,
      0
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new XeroApiError(
      `Xero token exchange failed (HTTP ${res.status}): ${
        body.error_description ?? body.error ?? res.statusText
      }`,
      res.status,
      body.error
    );
  }
  return body.access_token;
}

/**
 * Resolve the tenant id for a token. A pinned `tenantId` in the connector
 * config wins; otherwise the first connection Xero reports is used.
 */
async function resolveTenant(
  token: string,
  pinnedTenantId: string
): Promise<string> {
  if (pinnedTenantId) return pinnedTenantId;
  let res: Response;
  try {
    res = await fetch(XERO_CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new XeroApiError(
      `Xero connections endpoint unreachable: ${
        err instanceof Error ? err.message : "network error"
      }`,
      0
    );
  }
  if (!res.ok) {
    throw new XeroApiError(
      `Xero rejected the connections lookup (HTTP ${res.status}).`,
      res.status
    );
  }
  const connections = (await res.json().catch(() => [])) as Array<{
    tenantId?: string;
  }>;
  if (
    !Array.isArray(connections) ||
    connections.length === 0 ||
    !connections[0]?.tenantId
  ) {
    throw new XeroApiError(
      "No Xero connections are available for this credential.",
      404
    );
  }
  return connections[0].tenantId;
}

/**
 * Obtain an access token, honouring the upstream scope strategy:
 *   • an explicit `scopes` config value is used verbatim (no fallback);
 *   • otherwise the V1 bundle is tried first and the V2 bundle is used only
 *     when Xero answers `invalid_scope`.
 */
async function getToken(config: IntegrationConfig): Promise<string> {
  const clientId = String(config.clientId ?? "").trim();
  const clientSecret = String(config.clientSecret ?? "").trim();
  const requested = String(config.scopes ?? "").trim();

  if (requested) {
    return requestToken(clientId, clientSecret, requested);
  }
  try {
    return await requestToken(clientId, clientSecret, SCOPES_V1);
  } catch (err) {
    const isInvalidScope =
      err instanceof XeroApiError &&
      err.status === 400 &&
      err.code === "invalid_scope";
    if (!isInvalidScope) throw err;
    return requestToken(clientId, clientSecret, SCOPES_V2);
  }
}

/**
 * Build an authenticated Xero session for the stored connector configuration.
 * Throws {@link XeroNotConfiguredError} when no credential is present.
 */
export async function getXeroSession(
  config: IntegrationConfig
): Promise<XeroSession> {
  const bearer = String(config.bearerToken ?? "").trim();
  const pinnedTenantId = String(config.tenantId ?? "").trim();

  if (bearer) {
    const tenantId = await resolveTenant(bearer, pinnedTenantId);
    return { token: bearer, tenantId };
  }

  const clientId = String(config.clientId ?? "").trim();
  const clientSecret = String(config.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new XeroNotConfiguredError();
  }

  const key = cacheKey(config);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const tenantId = await resolveTenant(cached.token, pinnedTenantId);
    return { token: cached.token, tenantId };
  }

  const token = await getToken(config);
  tokenCache.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  const tenantId = await resolveTenant(token, pinnedTenantId);
  return { token, tenantId };
}

/** Drop cached tokens (used after the connector config is saved). */
export function invalidateXeroTokenCache() {
  tokenCache.clear();
}

/* ── transport ──────────────────────────────────────────────── */

/** Payroll endpoints are region-specific (AU / NZ / UK). */
export function payrollBase(region: string): string {
  const r = region.toUpperCase();
  if (r === "NZ") return "/PayrollNZ";
  if (r === "UK") return "/PayrollUK";
  return "/PayrollAU";
}

async function request<T>(
  path: string,
  session: XeroSession,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${XERO_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Xero-tenant-id": session.tenantId,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new XeroApiError(
      `Xero API unreachable: ${
        err instanceof Error ? err.message : "network error"
      }`,
      0
    );
  }
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as T & {
    ErrorNumber?: number;
    Message?: string;
    Detail?: string;
  };
  if (!res.ok) {
    const detail =
      (body as { Message?: string; Detail?: string }).Message ??
      (body as { Detail?: string }).Detail;
    throw new XeroApiError(
      detail
        ? `Xero responded ${res.status}: ${detail}`
        : `Xero responded ${res.status}.`,
      res.status
    );
  }
  return body;
}

export function xeroGet<T>(path: string, session: XeroSession): Promise<T> {
  return request<T>(path, session);
}

export function xeroPost<T>(
  path: string,
  session: XeroSession,
  body: unknown
): Promise<T> {
  return request<T>(path, session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function xeroDelete(path: string, session: XeroSession): Promise<void> {
  return request<void>(path, session, { method: "DELETE" });
}

/* ── probe (admin "Test connection") ────────────────────────── */

/**
 * Read-only connectivity check for the admin console. Proves the credential
 * is live by fetching the organisation record — nothing is created or sent.
 */
export async function probeXero(
  config: IntegrationConfig
): Promise<{ ok: boolean; detail: string }> {
  try {
    const session = await getXeroSession(config);
    const orgs = await xeroGet<{
      organisations?: Array<{ name?: string; organisationType?: string }>;
    }>("/Organisation", session);
    const org = orgs.organisations?.[0];
    if (!org)
      return {
        ok: false,
        detail: "Authenticated, but Xero returned no organisation.",
      };
    return {
      ok: true,
      detail: `Authenticated to Xero as “${org.name ?? "unknown"}” (${
        org.organisationType ?? "organisation"
      }).`,
    };
  } catch (err) {
    if (err instanceof XeroNotConfiguredError)
      return { ok: false, detail: err.message };
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "Xero request failed.",
    };
  }
}
