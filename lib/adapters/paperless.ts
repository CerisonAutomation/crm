/**
 * Paperless-ngx adapter (server-only).
 *
 * Talks to a real Paperless-ngx instance (see docker-compose.kyc.yml) over its
 * REST API. Paperless is the document-intake complement to the app's own vault:
 * it adds OCR, full-text search, correspondents/tags and a consume folder.
 *
 * Configuration is entirely env-driven (PAPERLESS_URL / PAPERLESS_API_TOKEN or
 * PAPERLESS_USERNAME+PAPERLESS_PASSWORD). When the service is unreachable the
 * methods throw a typed {@link KycStackError} — they NEVER fabricate a result,
 * so a caller can distinguish "Paperless is down" from "no documents".
 *
 * Server-only: reads process.env and must never reach a client bundle.
 */

import { KycStackError } from "@/lib/adapters/kyc-stack-error";

export type PaperlessHealth = {
  ok: boolean;
  /** Paperless version string when reachable, else null. */
  version: string | null;
  /** Human-readable reason when not ok. */
  detail: string | null;
};

export type PaperlessDocument = {
  id: number;
  title: string;
  correspondent: string | null;
  document_type: string | null;
  tags: string[];
  created: string;
  archived: string | null;
};

export type PaperlessDocumentPage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: PaperlessDocument[];
};

function baseUrl(): string {
  return (process.env.PAPERLESS_URL ?? "http://127.0.0.1:18000").replace(
    /\/$/,
    ""
  );
}

/** Authorization header for the Paperless REST API (token or basic auth). */
function authHeader(): Record<string, string> {
  const token = process.env.PAPERLESS_API_TOKEN?.trim();
  if (token) return { Authorization: `Token ${token}` };
  const user = process.env.PAPERLESS_USERNAME?.trim();
  const pass = process.env.PAPERLESS_PASSWORD ?? "";
  if (user) {
    return {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString(
        "base64"
      )}`,
    };
  }
  return {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        ...authHeader(),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
  } catch (err) {
    throw new KycStackError(
      "paperless",
      err instanceof Error ? err.message : "Paperless unreachable"
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = `Paperless responded ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string; error?: string };
      if (body.detail) detail = body.detail;
      else if (body.error) detail = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new KycStackError("paperless", detail);
  }
  return (await res.json()) as T;
}

/** Liveness probe — hits Paperless's API root, which returns 200 when up. */
export async function paperlessHealth(): Promise<PaperlessHealth> {
  try {
    const root = await request<{ version?: string }>("/api/");
    return { ok: true, version: root.version ?? null, detail: null };
  } catch (err) {
    return {
      ok: false,
      version: null,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

/** Upload a document for intake (OCR + indexing). `filename` is advisory. */
export async function uploadDocument(
  filename: string,
  content: string,
  opts: { title?: string; documentType?: string; tags?: number[] } = {}
): Promise<{ id: number; message: string }> {
  const form = new FormData();
  form.append("document", new Blob([Buffer.from(content, "base64")]), filename);
  if (opts.title) form.append("title", opts.title);
  if (opts.documentType) form.append("document_type", opts.documentType);
  for (const tag of opts.tags ?? []) form.append("tags", String(tag));
  // Let Paperless assign the id; the response carries the created document id.
  return request<{ id: number; message: string }>(
    "/api/documents/post_document/",
    {
      method: "POST",
      body: form,
    }
  );
}
