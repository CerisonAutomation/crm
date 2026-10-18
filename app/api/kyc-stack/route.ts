import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { paperlessHealth } from "@/lib/adapters/paperless";
import { yenteHealth } from "@/lib/adapters/yente";

/**
 * GET /api/kyc-stack — connectivity probe for the dev-side KYC services.
 *
 * Reports whether Paperless-ngx (document intake) and yente (sanctions search)
 * are reachable, by actually calling each service's real health endpoint. This
 * is the operational counterpart to `/api/health` (which probes the app's own
 * database/storage): it tells an admin whether the optional document/screening
 * stack is up, without exposing any credentials.
 *
 * Admin-only (`admin.manage`): the response reveals internal service topology,
 * which is not something a client or read-only auditor needs.
 */
export async function GET(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    requireCapability(ctx, "admin.manage");

    // Probe both services independently — one being down must not hide the
    // other's status.
    const [paperless, yente] = await Promise.all([paperlessHealth(), yenteHealth()]);

    const services: Record<string, { ok: boolean; version?: string | null; detail: string | null }> = {
      paperless: { ok: paperless.ok, version: paperless.version, detail: paperless.detail },
      yente: { ok: yente.ok, detail: yente.detail },
    };
    const up = Object.values(services).filter((s) => s.ok).length;

    return jsonOk({
      status: up === Object.keys(services).length ? "up" : up === 0 ? "down" : "degraded",
      services,
      // Echo the configured base URLs (never credentials) so an admin can see
      // WHERE the adapter is pointing when a probe reports down.
      config: {
        paperlessUrl: (process.env.PAPERLESS_URL ?? "http://127.0.0.1:18000").replace(/\/$/, ""),
        yenteUrl: (process.env.YENTE_URL ?? "http://127.0.0.1:18001").replace(/\/$/, ""),
      },
      time: new Date().toISOString(),
    });
  })(req);
}
