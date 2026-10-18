import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { createFormSchema, getFormSchemas } from "@/lib/services/form-schema";
import { validationFailed } from "@/lib/api-errors";

// GET /api/form-schemas?pageId=&status= — ADMIN-only.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const q = new URL(r.url).searchParams;
    const schemas = await getFormSchemas(ctx.orgId, {
      pageId: q.get("pageId") || undefined,
      status: q.get("status") || undefined,
    });
    return jsonOk({ schemas });
  })(req);
}

// POST /api/form-schemas
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const body = await readJson<{
      schema?: string;
      pageId?: string;
      version?: number;
    }>(r);
    if (!body?.schema) throw validationFailed("schema is required");
    const formSchema = await createFormSchema({
      orgId: ctx.orgId,
      schema: body.schema,
      pageId: body.pageId,
      version: body.version,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "form_schema.created",
      target: formSchema.id,
      after: { pageId: formSchema.pageId ?? null, version: formSchema.version },
      correlationId,
    });
    return jsonOk({ schema: formSchema }, 201);
  })(req);
}
