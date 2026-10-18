import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { programmeByKey, publicChecklist, publicProgrammeCard, programmeFamily } from "@/lib/domain/programmes";
import { kindForSeedKey } from "@/lib/domain/programme-alias";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog — PUBLIC programme catalogue (the marketing surface).
 *
 * Serves only fields a prospect may see, joined from TWO sources so the page is
 * never stale:
 *   • the database row  — name, country, description (editorially maintained)
 *   • the capability catalogue — authority, fee, timeline, family (researched)
 *
 * `?key=<PROGRAMME_KEY>` returns one programme plus its indicative document
 * checklist. Requirements are exposed as resolved LABELS; the desk's screening
 * set stays internal. `indicative: true` travels with every payload so no
 * client can render a threshold as though it were a quotation.
 *
 * The authed /api/programmes remains the staff/client selection surface.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const key = new URL(r.url).searchParams.get("key");

    if (key) {
      const row = await db.programme.findFirst({
        where: { key, active: true },
        select: { key: true, name: true, country: true, description: true },
      });
      if (!row) return jsonOk({ programme: null }, 404);

      const cap = programmeByKey(key);
      return jsonOk({
        indicative: true,
        programme: {
          ...row,
          family: programmeFamily(key),
          ...(cap ? publicProgrammeCard(cap) : {}),
          // The card contract's `kind` describes the OPERATIONAL route; the
          // capability alias behind it may be a different kind (see
          // kindForSeedKey), so it is always taken from the seeded key.
          kind: kindForSeedKey(key),
          checklist: publicChecklist(key),
          watchFactors: cap ? cap.watchFactors : [],
        },
      });
    }

    const rows = await db.programme.findMany({
      where: { active: true },
      select: { key: true, name: true, country: true, description: true },
      orderBy: { country: "asc" },
    });

    const programmes = rows.map((row) => {
      const cap = programmeByKey(row.key);
      return {
        ...row,
        // The public card contract is `label`/`summary` (the marketing client
        // and the offline fallback both read those names). The DB row calls
        // them `name`/`description`, so project them here — a spread-only row
        // would render blank cards the moment the live catalogue replaced the
        // fallback.
        label: row.name,
        summary: row.description,
        family: programmeFamily(row.key),
        // Catalogue data is joined in where the programme is researched; the row
        // still renders without it, so a newly seeded programme is never blank.
        authority: cap?.authority ?? null,
        feeChf: cap?.feeChf ?? null,
        complexity: cap?.complexity ?? null,
        processingWeeks: cap?.processingWeeks ?? null,
        minInvestment: cap?.minInvestment ?? null,
        currency: cap?.currency ?? null,
        kind: kindForSeedKey(row.key),
        legalBasis: cap?.legalBasis ?? null,
        reviewedOn: cap?.reviewedOn ?? null,
      };
    });

    return jsonOk({
      indicative: true,
      note: "Thresholds and timelines are indicative planning figures, verified against the official source before any engagement.",
      programmes,
      families: {
        CITIZENSHIP: programmes.filter((p) => p.family === "EU_CITIZENSHIP").length,
        // Services and investment lines are neither, so they no longer inflate
        // the residence count the landing page renders.
        RESIDENCE: programmes.filter(
          (p) => p.family !== "EU_CITIZENSHIP" && p.family !== "SERVICES",
        ).length,
      },
    });
  })(req);
}
