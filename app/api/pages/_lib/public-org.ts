import { db } from "@/lib/db";

/**
 * Which Organisation owns the PUBLIC Journal.
 *
 * The public pages surface is unauthenticated, so it cannot derive a tenant from
 * a session — it has to be told which tenant is "public". Resolution order:
 *
 *  1. `LANE_PUBLIC_ORG_ID` — an Organisation **id OR slug**, so an operator can
 *     set the human-readable slug. Given a value, that value is authoritative: if
 *     it names no Organisation we expose NOTHING (fail closed) rather than
 *     silently falling back to some other tenant.
 *  2. Fallback (env unset): the single Organisation, IF there is exactly one.
 *     This is the single-tenant assumption — safe because a one-org deployment
 *     has no other tenant whose pages could leak. With two or more organisations
 *     and nothing configured we FAIL CLOSED (return null): the public list is
 *     empty and a detail lookup 404s, rather than guessing a tenant.
 *
 * A `null` result means "no public tenant is configured" — callers must treat it
 * as "expose nothing", never as "no filter".
 */
export const PUBLIC_ORG_ENV = "LANE_PUBLIC_ORG_ID";

export async function resolvePublicOrgId(): Promise<string | null> {
  const configured = process.env[PUBLIC_ORG_ENV]?.trim();
  if (configured) {
    const byId = await db.organisation.findUnique({ where: { id: configured }, select: { id: true } });
    if (byId) return byId.id;
    const bySlug = await db.organisation.findUnique({ where: { slug: configured }, select: { id: true } });
    if (bySlug) return bySlug.id;
    console.warn(
      `[pages/public] ${PUBLIC_ORG_ENV}=\"${configured}\" names no Organisation — public pages are disabled (fail closed).`
    );
    return null;
  }

  // Single-tenant fallback: only exactly one Organisation is unambiguous.
  const orgs = await db.organisation.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (orgs.length === 1) return orgs[0].id;
  if (orgs.length > 1) {
    console.warn(
      `[pages/public] ${orgs.length}+ Organisations and ${PUBLIC_ORG_ENV} is unset — public pages are disabled (fail closed).`
    );
  }
  return null;
}
