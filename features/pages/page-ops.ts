"use client";
/**
 * page-ops — the Lane Pages operations the typed `api` client does not expose:
 * the revision history, a rollback (pointer move), and the signed draft-preview
 * link. Kept beside the feature (not in the shared api-client) and authenticates
 * with the SAME session token/bearer the api-client uses, so an in-iframe preview
 * and a normal browser both work.
 */
import { ApiError, currentSessionToken } from "@/lib/api-client";

export type PageRevisionRow = {
  id: string;
  version: number;
  title: string;
  note: string | null;
  authorLabel: string | null;
  createdAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = currentSessionToken();
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    ...init,
    headers: {
      ...headers,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
    credentials: "same-origin",
    signal: AbortSignal.timeout(10_000),
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const message =
      body &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    const errorCode =
      body &&
      typeof body === "object" &&
      typeof (body as { errorCode?: unknown }).errorCode === "string"
        ? (body as { errorCode: string }).errorCode
        : null;
    throw new ApiError(message, res.status, errorCode, null);
  }
  return body as T;
}

export const pageOps = {
  /** The page's immutable revision history (newest first). */
  revisions: (id: string) =>
    request<{
      revisions: PageRevisionRow[];
      currentRevisionId: string | null;
      publishedRevisionId: string | null;
      version: number;
      status: string;
    }>(`/api/pages/${id}/revisions`),

  /** Move the page pointer onto an earlier revision (draft; live too when published). */
  rollback: (id: string, revisionId: string) =>
    request<{
      ok: boolean;
      revisionId: string;
      version: number;
      status: string;
      published: boolean;
    }>(`/api/pages/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ revisionId }),
    }),

  /** Mint a signed, expiring draft-preview URL (`/p/{slug}?preview=…`). */
  previewLink: (id: string) =>
    request<{ url: string }>(`/api/pages/${id}/preview`),
};
