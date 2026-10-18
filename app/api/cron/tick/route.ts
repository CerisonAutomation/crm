import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handler, jsonOk } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";
/** Worst case: dispatch cycle + 5-minute sweep + webhook retries, well inside. */
export const maxDuration = 60;

/**
 * Unified serverless clock — replaces the in-process setInterval schedulers on
 * Vercel (Fluid Compute freezes timers between invocations and scales to zero).
 *
 * Triggered every minute by Vercel Cron (per-minute schedule in vercel.json;
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the env
 * var is set, satisfying cronAuthorized below — set CRON_SECRET in the Vercel
 * project or every tick 401s and scheduled work silently stops, caught only by
 * the deployment readiness gate). Hobby-plan projects are daily-only: pair with
 * an external per-minute pinger presenting the same bearer token.
 *
 * Every tick runs the automation dispatch cycle; every 5th tick also runs the
 * reminder sweep + webhook retry sweep; once a day it prunes finished queue
 * rows. All four callees are idempotent via conditional DB writes, so missed
 * or doubled ticks are harmless.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, constant-time compared, fail
 * closed (401 when the secret is unset server-side). Accepts GET (Vercel Cron)
 * and POST (external pingers).
 */
function cronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  const header = req.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function tick(req: NextRequest) {
  return handler(async () => {
    if (!cronAuthorized(req))
      throw new DomainError("Unauthorized cron call", 401);

    const { runAutomationDispatchCycle, pruneAutomationJobs } = await import(
      "@/lib/automation/queue"
    );
    const { runSweep } = await import("@/lib/services/reminders");
    const { processDueRetries } = await import("@/lib/integrations/webhooks");
    const { purgeUnclaimedLeads } = await import("@/app/api/leads/route");

    const now = new Date();
    // PERF-3: independent legs run concurrently under one allSettled — a slow
    // or failing leg can neither stall the others past maxDuration nor abort
    // the tick (previously a sweep/webhook throw 500d the whole tick and
    // starved every leg after it). All legs are idempotent, so overlap is safe.
    // The dispatch leg still fails the tick when IT fails (cron monitoring
    // watches it); every other leg degrades to its default with an error log.
    const legs: Record<string, Promise<unknown>> = {
      dispatch: runAutomationDispatchCycle("cron-tick"),
    };
    if (now.getUTCMinutes() % 5 === 0) {
      // Overlap marker: if an in-process sweeper fired recently, both drivers
      // are active (self-hosted + external pinger) — one log line, not silent.
      const { noteSweeperRun, sweepOverlapCountSinceBoot } = await import(
        "@/lib/automation/scheduler"
      );
      const overlap = noteSweeperRun("tick");
      if (overlap) {
        console.warn(
          `[automation] sweep overlap: ${
            overlap.driver
          } driver swept ${Math.round(
            (Date.now() - overlap.at) / 1000
          )}s ago — duplicate work, idempotent (count=${sweepOverlapCountSinceBoot()})`
        );
      }
      legs.sweep = runSweep();
      legs.webhooks = processDueRetries();
      // SLA breach sweep (BLUEPRINT SLA-PAUSE): shared-cadence entrypoint.
      // Per-org failures are contained in the service; the count here is
      // observability only — the audit rows are the durable record.
      const { checkAllSLABreaches } = await import("@/lib/services/sla");
      legs.slaBreached = checkAllSLABreaches().then((r) => r.breached);
    }
    // Once-daily retention inside the ~05:00 UTC tick (pairs with the
    // vercel.json daily safety-net cron on the same route).
    if (now.getUTCHours() === 5 && now.getUTCMinutes() < 5) {
      legs.pruned = pruneAutomationJobs();
      // Ponytail-S #4: 90-day auto-delete of unclaimed public intake.
      legs.leadsPurged = purgeUnclaimedLeads(now);
    }
    const keys = Object.keys(legs);
    const settled = await Promise.allSettled(keys.map((k) => legs[k]));
    const out: Record<string, unknown> = {};
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") out[keys[i]] = r.value;
      else console.error(`[cron-tick] leg ${keys[i]} failed`, r.reason);
    });
    if (settled[0].status === "rejected") throw settled[0].reason;

    return jsonOk({
      at: now.toISOString(),
      dispatch: out.dispatch,
      sweep: out.sweep ?? null,
      webhooks: out.webhooks ?? 0,
      pruned: out.pruned ?? 0,
      leadsPurged: out.leadsPurged ?? 0,
      slaBreached: out.slaBreached ?? 0,
    });
  })(req);
}

export async function POST(req: NextRequest) {
  return tick(req);
}

export async function GET(req: NextRequest) {
  return tick(req);
}
