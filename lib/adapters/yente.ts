/**
 * yente adapter (server-only).
 *
 * Talks to a real yente instance (OpenSanctions' search server — see
 * docker-compose.kyc.yml) over its REST API. yente is the sanctions / PEP /
 * watchlist complement to the app's own screening ledger: it answers "does this
 * name appear on a sanctions list?" against real OpenSanctions data.
 *
 * Configuration is env-driven (YENTE_URL). yente runs with no auth by default
 * (the compose sets `xpack.security.enabled=false`), so no credential is sent.
 * When the service is unreachable the methods throw a typed
 * {@link KycStackError} — they NEVER fabricate a match or a clean bill.
 *
 * Server-only: reads process.env and must never reach a client bundle.
 */

import { KycStackError } from "@/lib/adapters/kyc-stack-error";

export type YenteHealth = {
  ok: boolean;
  detail: string | null;
};

export type YenteDataset = {
  name: string;
  title: string;
  summary: string | null;
  entityCount: number;
};

export type YenteEntity = {
  id: string;
  caption: string;
  schema: string;
  properties: Record<string, unknown>;
};

export type YenteSearchResponse = {
  total: { value: number; relation: string };
  results: Array<{
    entity: YenteEntity;
    score: number;
    match: boolean;
    datasets: string[];
  }>;
};

function baseUrl(): string {
  return (process.env.YENTE_URL ?? "http://127.0.0.1:18001").replace(/\/$/, "");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
  } catch (err) {
    throw new KycStackError(
      "yente",
      err instanceof Error ? err.message : "yente unreachable"
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = `yente responded ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string; error?: string };
      if (body.detail) detail = body.detail;
      else if (body.error) detail = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new KycStackError("yente", detail);
  }
  return (await res.json()) as T;
}

/** Liveness probe — yente's `/healthz` returns 200 when the index is ready. */
export async function yenteHealth(): Promise<YenteHealth> {
  try {
    await request<{ status?: string }>("/healthz");
    return { ok: true, detail: null };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

/**
 * List the datasets yente has loaded (sanctions lists, PEP, …).
 *
 * Restored with the screening-match route: `YenteDataset` was declared here but
 * unused, because only the liveness probe survived. Reuses `request()` above, so
 * transport concerns (8s abort, typed `KycStackError`, error-body extraction)
 * stay in one place.
 */
export async function listDatasets(): Promise<YenteDataset[]> {
  const res = await request<{ datasets: YenteDataset[] }>("/datasets");
  return res.datasets ?? [];
}

/**
 * Fuzzy-match a structured query (name + optional birth date / country) against
 * a dataset. This is the endpoint a real screening flow uses to score a person.
 *
 * An empty `results` array is a genuine "no match", NOT a service failure — a
 * failure throws a `KycStackError`, which is what lets the caller fail closed
 * instead of reporting a clean bill it never got.
 */
export async function matchDataset(
  dataset: string,
  query: { name: string; birthDate?: string; country?: string; limit?: number },
): Promise<YenteSearchResponse> {
  return request<YenteSearchResponse>(`/match/${encodeURIComponent(dataset)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queries: {
        name: query.name,
        ...(query.birthDate ? { birth_date: query.birthDate } : undefined),
        ...(query.country ? { country: query.country } : undefined),
      },
      limit: query.limit ?? 5,
    }),
  });
}
