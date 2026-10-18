import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createPollConnection, getPollConnections } from "@/lib/services/poll-connection";
import { validationFailed } from "@/lib/api-errors";

const SOURCE_TYPES = ["EMAIL", "API", "FTP", "WEBHOOK"] as const;

// GET /api/poll-connections?status=&sourceType= — ADMIN-only.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const q = new URL(r.url).searchParams;
    const connections = await getPollConnections(ctx.orgId, {
      status: q.get("status") || undefined,
      sourceType: q.get("sourceType") || undefined,
    });
    return jsonOk({ connections });
  })(req);
}

// POST /api/poll-connections
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      sourceType?: string;
      owner?: string;
      schedule?: string;
      jitter?: number;
      timeoutMs?: number;
      cursorMode?: "TIMESTAMP" | "ID" | "OFFSET";
      pageSize?: number;
      rateBudget?: number;
      secretRef?: string;
      dataClass?: "PUBLIC" | "INTERNAL" | "PII" | "RESTRICTED";
      pausePolicy?: "NEVER" | "ON_ERROR" | "ON_RATE_LIMIT";
    }>(r);
    if (!body?.sourceType) throw validationFailed("sourceType is required");
    if (!(SOURCE_TYPES as readonly string[]).includes(body.sourceType)) {
      throw validationFailed("sourceType must be EMAIL, API, FTP or WEBHOOK");
    }
    if (!body?.owner) throw validationFailed("owner is required");
    if (!body?.schedule) throw validationFailed("schedule is required");
    const connection = await createPollConnection({
      orgId: ctx.orgId,
      sourceType: body.sourceType as (typeof SOURCE_TYPES)[number],
      owner: body.owner,
      schedule: body.schedule,
      jitter: body.jitter,
      timeoutMs: body.timeoutMs,
      cursorMode: body.cursorMode,
      pageSize: body.pageSize,
      rateBudget: body.rateBudget,
      secretRef: body.secretRef,
      dataClass: body.dataClass,
      pausePolicy: body.pausePolicy,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "poll_connection.created",
      target: connection.id,
      after: { sourceType: connection.sourceType, owner: connection.owner },
      correlationId,
    });
    return jsonOk({ connection }, 201);
  })(req);
}
