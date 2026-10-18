import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { matchDataset, listDatasets, type YenteSearchResponse } from "@/lib/adapters/yente";
import {
  SCREENING_CUTOFF,
  screeningNameKeys,
  screeningQueries,
} from "@/lib/kyc/screening-names";

export const dynamic = "force-dynamic";

/**
 * POST /api/screenings/match — ask the sanctions matcher about a name.
 *
 * This is the *query* half of screening: it never writes a result and never
 * decides. It exists so a desk user (or an agent through MCP) can see what the
 * matcher says about a subject before recording a screening outcome, and so the
 * recorded outcome can cite the exact queries that were run.
 *
 * Three properties are deliberate:
 *
 * 1. **Variation coverage.** A single string misses the benign classes ordinary
 *    customers produce (initials, dropped middle names, name order,
 *    transliteration). `screeningQueries` sends a small, deterministic set, and
 *    every hit records WHICH variant produced it (`matchedVia`).
 * 2. **Union, not union-of-noise.** Hits are merged by entity id and keep their
 *    best score; the response is sorted and capped, so the reader sees one row
 *    per person, not one row per query.
 * 3. **Fail-closed.** If the matcher cannot be reached, this route answers 503.
 *    It never fabricates a match and never returns an empty list that a caller
 *    could mistake for "clean".
 * 4. **Cutoff is not threshold.** `cutoff` is a noise floor that decides what is
 *    worth showing a human; the matcher's own threshold decides what is a hit.
 *    They are separate numbers (see `SCREENING_CUTOFF`). Candidates at or below
 *    `cutoff` are dropped and counted in `dropped`, so filtering is never
 *    mistaken for absence.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");

    const body = await readJson<{
      name?: string;
      birthDate?: string;
      country?: string;
      dataset?: string;
      limit?: number;
      cutoff?: number;
    }>(r);

    const name = (body.name ?? "").trim();
    if (name.length < 2) throw new DomainError("A name of at least 2 characters is required", 400);
    if (name.length > 200) throw new DomainError("Name is too long", 400);

    const dataset = (body.dataset ?? "default").trim() || "default";
    const limit = Math.min(Math.max(Math.trunc(body.limit ?? 5), 1), 20);

    // Noise floor. Distinct from the matcher's own match threshold: `cutoff`
    // decides what is worth showing a human at all, not what counts as a hit.
    // Candidates scoring <= cutoff are dropped, mirroring yente's
    // `if response.score <= cutoff: continue`.
    const cutoff = Number.isFinite(body.cutoff)
      ? Math.min(Math.max(Number(body.cutoff), 0), 1)
      : SCREENING_CUTOFF;

    const queries = screeningQueries(name, 4);

    type Hit = {
      id: string;
      caption: string;
      schema: string;
      score: number;
      datasets: string[];
      matchedVia: string[];
      keys: string;
    };

    const settled = await Promise.allSettled(
      queries.map((q) => matchDataset(dataset, { name: q, birthDate: body.birthDate, country: body.country, limit })),
    );

    const failures = settled.filter((s) => s.status === "rejected");
    if (failures.length === settled.length) {
      // Fail closed with 503: an unreachable matcher must never be read as
      // "nothing found", which is how a screening gap ships to production.
      const first = failures[0] as PromiseRejectedResult;
      const detail = first.reason instanceof Error ? first.reason.message : "screening matcher unreachable";
      throw new DomainError(`Screening matcher unavailable: ${detail}`, 503);
    }

    const hits = new Map<string, Hit>();
    settled.forEach((outcome, index) => {
      if (outcome.status !== "fulfilled") return;
      const response = outcome.value as YenteSearchResponse;
      for (const result of response.results ?? []) {
        const via = queries[index];
        const existing = hits.get(result.entity.id);
        if (existing) {
          existing.score = Math.max(existing.score, result.score);
          if (!existing.matchedVia.includes(via)) existing.matchedVia.push(via);
          for (const d of result.datasets ?? []) if (!existing.datasets.includes(d)) existing.datasets.push(d);
          continue;
        }
        hits.set(result.entity.id, {
          id: result.entity.id,
          caption: result.entity.caption,
          schema: result.entity.schema,
          score: result.score,
          datasets: result.datasets ?? [],
          matchedVia: [via],
          keys: JSON.stringify(screeningNameKeys(via)),
        });
      }
    });

    const ranked = [...hits.values()].sort((a, b) => b.score - a.score);
    // Drop first, then cap: the cap should apply to what is worth showing, not
    // to the noise that happened to rank above it.
    const ordered = ranked.filter((hit) => hit.score > cutoff).slice(0, limit);
    const dropped = ranked.length - ranked.filter((hit) => hit.score > cutoff).length;

    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.role} screening query`,
      action: "screening.match",
      target: dataset,
      after: { name, queries, hits: ordered.length },
    });

    // Informational only: the loaded list set (which sanctions/PEP datasets the
    // matcher holds). A failure here does not degrade the query result.
    let datasets: string[] = [];
    try {
      datasets = (await listDatasets()).map((d) => d.name);
    } catch {
      datasets = [];
    }
    const degraded = failures.length > 0;

    return jsonOk({
      dataset,
      queries,
      hits: ordered,
      /** The noise floor applied, so a reader can tell "filtered" from "absent". */
      cutoff,
      /** How many merged candidates fell at or below `cutoff`. */
      dropped,
      degraded,
      datasets,
      /** What the reader must do next: a human decides the screening outcome. */
      notice:
        "Scores are the matcher's, not a compliance decision — record the outcome in the case's screening ledger.",
    });
  })(req);
}
