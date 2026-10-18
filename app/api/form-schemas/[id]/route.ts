import { NextRequest } from "next/server";
import { requireAuth, requireCapability } from "@/lib/auth";
import { handler, jsonOk, readJson, audit, actorLabel } from "@/lib/api-helpers";
import { deleteFormSchema, getFormSchema, updateFormSchema } from "@/lib/services/form-schema";
import { notFound } from "@/lib/api-errors";

async function ownedSchema(id: string, orgId: string) {
  const formSchema = await getFormSchema(id);
  if (!formSchema || formSchema.orgId !== orgId) throw notFound("Form schema not found");
  return formSchema;
}

// GET /api/form-schemas/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    const formSchema = await ownedSchema(id, ctx.orgId);
    return jsonOk({ schema: formSchema });
  })(req);
}

// PATCH /api/form-schemas/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedSchema(id, ctx.orgId);
    const body = await readJson<{
      schema?: string;
      status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    }>(r);
    const formSchema = await updateFormSchema(id, body);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "form_schema.updated",
      target: formSchema.id,
      after: body,
      correlationId,
    });
    return jsonOk({ schema: formSchema });
  })(req);
}

// DELETE /api/form-schemas/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "admin.manage");
    const { id } = await params;
    await ownedSchema(id, ctx.orgId);
    await deleteFormSchema(id);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "form_schema.deleted",
      target: id,
      correlationId,
    });
    return jsonOk({ ok: true });
  })(req);
}
