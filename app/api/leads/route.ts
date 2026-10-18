import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { hit } from "@/lib/rate-limit";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

/** The sales-pipeline stages, in funnel order. */
const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
type LeadStage = (typeof LEAD_STAGES)[number];

/** Map the coarse legacy `status` onto a pipeline stage, for rows written before `stage` existed. */
function stageFromStatus(status: string): LeadStage {
  if (status === "CONVERTED") return "WON";
  if (status === "ARCHIVED") return "LOST";
  if (status === "QUALIFIED") return "QUALIFIED";
  if (status === "CONTACTED") return "CONTACTED";
  return "NEW";
}

// POST /api/leads — PUBLIC intake (marketing forms). Unauthenticated by design,
// rate-limited per IP (20/hour), strictly normalised. Returns nothing sensitive.
export async function POST(req: NextRequest) {
  return handler(async () => {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "unknown";
    const gate = hit(`lead:capture:${ip}`, 20, 3_600_000);
    if (!gate.allowed) {
      throw new DomainError(`Too many enquiries from this address — try again in ${gate.retryAfterSec}s`, 429);
    }
    const body = await readJson<{ name?: unknown; email?: unknown; phone?: unknown; source?: unknown; message?: unknown; website?: unknown }>(req);
    // Honeypot (ponytail-S #4): the invisible `website` field is never rendered
    // to humans — a filled value is a bot. Same bare success, nothing stored.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return jsonOk({ received: true });
    }
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 160) : "";
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DomainError("Name and a valid email are required", 400);
    }
    const allowedSources = ["SITE", "REFERRAL", "EVENT", "PARTNER", "OTHER"];
    const source =
      typeof body.source === "string" && allowedSources.includes(body.source.toUpperCase())
        ? body.source.toUpperCase()
        : "SITE";
    await db.lead.create({
      data: {
        name,
        email,
        phone: typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : null,
        source,
        message: typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "",
      },
    });
    return jsonOk({ received: true });
  })(req);
}

/**
 * Purge unclaimed public intake older than 90 days (ponytail-S #4,
 * data-minimization): a lead nobody touched (NEW/NEW, no owner) is not a
 * prospect, it is residue. Claimed/converted rows are never purged here.
 * Called from the daily retention window in /api/cron/tick.
 */
export async function purgeUnclaimedLeads(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const res = await db.lead
    .deleteMany({
      where: { status: "NEW", stage: "NEW", ownerId: null, createdAt: { lt: cutoff } },
    })
    .catch(() => ({ count: 0 }));
  return res.count;
}

// GET /api/leads — staff queue. Filters by coarse `status` and/or pipeline `stage`.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);
    const status = url.searchParams.get("status");
    const stage = url.searchParams.get("stage");
    // Tenant-scoped queue: NULL-org intake rows stay invisible here by design
    // (service-triaged); claimed rows carry the org stamped at claim time.
    const leads = await withTenantContext(ctx.orgId, (tx) =>
      tx.lead.findMany({
        where: { ...(status ? { status } : {}), ...(stage ? { stage } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
    return jsonOk({ leads });
  })(req);
}

// PATCH /api/leads — staff move a lead through the pipeline. `status` is kept in
// step with `stage` so the legacy coarse funnel still reads correctly.
export async function PATCH(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const body = await readJson<{ id?: string; stage?: string; ownerId?: string | null }>(r);
    if (!body.id) throw new DomainError("An id is required", 400);
    // PK lookup stays global so NULL-org intake rows are claimable; the tenant
    // write below (orgId stamp) is what enforces ownership. Existence oracle is
    // cuid-guess-only and every touch is audit-logged.
    const lead = await db.lead.findUnique({ where: { id: body.id } });
    if (!lead) throw new DomainError("Lead not found", 404);
    if (lead.orgId && lead.orgId !== ctx.orgId) throw new DomainError("Lead not found", 404);
    const stage =
      body.stage && (LEAD_STAGES as readonly string[]).includes(body.stage) ? (body.stage as LeadStage) : undefined;
    if (body.stage && !stage) throw new DomainError(`Unknown stage: ${body.stage}`, 400);
    const statusForStage: Record<LeadStage, string> = {
      NEW: "NEW", CONTACTED: "CONTACTED", QUALIFIED: "QUALIFIED", PROPOSAL: "QUALIFIED", WON: "CONVERTED", LOST: "ARCHIVED",
    };
    // Claim stamps the org: a touched lead joins this tenant's queue. A zero-row
    // update (missing, foreign-org, or NULL-intake under RLS) surfaces as P2025
    // and maps to 404 — never a 500, never an existence oracle beyond the id.
    // NULL-intake claims run via the service identity (see ADR-002).
    let updated;
    try {
      updated = await withTenantContext(ctx.orgId, (tx) =>
        tx.lead.update({
          where: { id: body.id },
          data: {
            orgId: ctx.orgId,
            ...(stage ? { stage, status: statusForStage[stage] } : {}),
            ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          },
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === "P2025") throw new DomainError("Lead not found", 404);
      throw err;
    }
    await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "lead.stage.changed", target: lead.id, before: { stage: lead.stage ?? stageFromStatus(lead.status) }, after: { stage: updated.stage, ownerId: updated.ownerId }, correlationId });
    return jsonOk({ lead: updated });
  })(req);
}
