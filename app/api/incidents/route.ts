import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { createIncident, getIncidents } from "@/lib/services/incident";
import { validationFailed } from "@/lib/api-errors";

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const { orgId } = await requireAuth(r);
    const incidents = await getIncidents(orgId);
    return jsonOk({ incidents });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{ title?: string; description?: string; severity?: string }>(r);
    const title = body?.title as string;
    if (!title) throw validationFailed("Title is required");
    const incident = await createIncident({
      orgId: ctx.orgId,
      title,
      description: body?.description,
      severity: body?.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined,
      assignedTo: ctx.userId,
    });
    return jsonOk({ incident }, 201);
  })(req);
}
