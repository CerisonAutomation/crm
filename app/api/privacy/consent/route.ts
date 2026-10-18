import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

const KEYS = ["terms", "privacy", "cookies", "marketing", "ai-local", "ai-cloud"];

// GET /api/privacy/consent — my consent records.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const consents = await db.consent.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" } });
    return jsonOk({ consents });
  })(req);
}

// POST /api/privacy/consent { key, version?, granted? } — record a consent decision.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ key?: unknown; version?: unknown; granted?: unknown }>(r);
    if (typeof body.key !== "string" || !KEYS.includes(body.key)) throw new DomainError("Unknown consent key", 400);
    const version = typeof body.version === "string" && body.version ? body.version.slice(0, 20) : "1";
    const saved = await db.consent.upsert({
      where: { userId_key_version: { userId: ctx.userId, key: body.key, version } },
      create: { userId: ctx.userId, key: body.key, version, granted: body.granted !== false },
      update: { granted: body.granted !== false },
    });
    await audit({ orgId: ctx.orgId, action: "privacy.consent", target: body.key, actorId: ctx.userId, actorLabel: ctx.name, after: { granted: saved.granted, version } });
    return jsonOk({ consent: saved });
  })(req);
}
