import { db } from "@/lib/db";

export interface CreateFormSchemaInput {
  orgId: string;
  pageId?: string;
  version?: number;
  schema: string;
}

export interface UpdateFormSchemaInput {
  schema?: string;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

export async function createFormSchema(input: CreateFormSchemaInput) {
  return db.formSchema.create({
    data: {
      orgId: input.orgId,
      pageId: input.pageId,
      version: input.version ?? 1,
      schema: input.schema,
    },
  });
}

export async function getFormSchema(id: string) {
  return db.formSchema.findUnique({
    where: { id },
  });
}

export async function getFormSchemas(orgId: string, filters?: {
  pageId?: string;
  status?: string;
}) {
  return db.formSchema.findMany({
    where: {
      orgId,
      ...(filters?.pageId ? { pageId: filters.pageId } : undefined),
      ...(filters?.status ? { status: filters.status } : undefined),
    },
    orderBy: [{ pageId: "asc" }, { version: "desc" }],
  });
}

export async function getLatestFormSchema(pageId: string) {
  return db.formSchema.findFirst({
    where: { pageId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
}

export async function updateFormSchema(id: string, input: UpdateFormSchemaInput) {
  return db.formSchema.update({
    where: { id },
    data: input,
  });
}

export async function deleteFormSchema(id: string) {
  return db.formSchema.delete({
    where: { id },
  });
}
