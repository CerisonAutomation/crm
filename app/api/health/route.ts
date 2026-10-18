import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { deploymentReport } from "@/lib/deployment";
import { activeStorageDriver } from "@/lib/storage";

// GET /api/health — readiness probe
export async function GET(req: NextRequest) {
  return handler(async () => {
    const checks: Record<string, string> = {};
    try {
      await db.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "down";
    }
    checks.vapid = process.env.VAPID_PUBLIC_KEY ? "configured" : "missing";
    checks.storage = activeStorageDriver();
    const ready = checks.database === "ok";
    // The deployment report names exactly which configuration is missing, so a
    // failing probe is diagnosable from the response alone rather than from logs.
    const deployment = deploymentReport();
    return jsonOk(
      {
        status: ready ? "ready" : "degraded",
        checks,
        deployment: {
          host: deployment.host,
          readiness: deployment.readiness,
          findings: deployment.findings.map((f) => `${f.severity}: ${f.key} — ${f.impact}`),
        },
        time: new Date().toISOString(),
      },
      ready ? 200 : 503
    );
  })(req);
}
