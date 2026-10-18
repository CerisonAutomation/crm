/**
 * GitHub API client (REST v3).
 *
 * A dependency-free (fetch-only) client mirroring the capability surface of
 * the official GitHub MCP server (https://github.com/github/github-mcp-server):
 * repositories, issues, pull requests, commits, file contents and search.
 *
 * Credentials are NEVER hardcoded: the client reads its configuration from the
 * IntegrationSetting row (admin console) through getIntegration("github").
 * When the connector is inactive/unconfigured, getGithubSession throws
 * GithubNotConfiguredError and every github_* MCP tool answers with a
 * structured configured: false result instead of failing.
 */

import { getIntegration, type IntegrationConfig } from "@/lib/integrations";

const DEFAULT_API_BASE = "https://api.github.com";

export interface GithubSession {
  token: string;
  apiBaseUrl: string;
}

export class GithubNotConfiguredError extends Error {
  constructor(message = "GitHub is not configured - save the connector first.") {
    super(message);
    this.name = "GithubNotConfiguredError";
  }
}

export class GithubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

export async function getGithubConfig(): Promise<IntegrationConfig> {
  const { config } = await getIntegration("github");
  return config;
}

export async function getGithubSession(config: IntegrationConfig): Promise<GithubSession> {
  const token = String(config.personalAccessToken ?? config.apiToken ?? "").trim();
  if (!token) {
    throw new GithubNotConfiguredError();
  }
  const apiBaseUrl = String(config.apiBaseUrl ?? DEFAULT_API_BASE).trim().replace(/\/$/, "");
  return { token, apiBaseUrl };
}

async function request<T>(path: string, session: GithubSession, init?: RequestInit): Promise<T> {
  const base = session.apiBaseUrl || DEFAULT_API_BASE;
  const url = path.startsWith("http") ? path : base + (path.startsWith("/") ? "" : "/") + path;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: "Bearer " + session.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init && init.headers ? init.headers : undefined),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new GithubApiError(
      "GitHub API unreachable: " + (err instanceof Error ? err.message : "network error"),
      0
    );
  }
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    throw new GithubApiError(
      body && body.message ? "GitHub responded " + res.status + ": " + body.message : "GitHub responded " + res.status + ".",
      res.status
    );
  }
  return body;
}

export function githubGet<T>(path: string, session: GithubSession): Promise<T> {
  return request<T>(path, session);
}

export function githubPost<T>(path: string, session: GithubSession, body: unknown): Promise<T> {
  return request<T>(path, session, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function githubPatch<T>(path: string, session: GithubSession, body: unknown): Promise<T> {
  return request<T>(path, session, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function probeGithub(config: IntegrationConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const session = await getGithubSession(config);
    const me = await githubGet<{ login?: string; name?: string }>("/user", session);
    const label = me && (me.login || me.name);
    if (!label) {
      return { ok: false, detail: "Authenticated, but GitHub returned no user profile." };
    }
    return { ok: true, detail: 'Authenticated to GitHub as "' + label + '".' };
  } catch (err) {
    if (err instanceof GithubNotConfiguredError) return { ok: false, detail: err.message };
    return { ok: false, detail: err instanceof Error ? err.message : "GitHub request failed." };
  }
}
