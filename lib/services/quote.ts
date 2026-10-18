import { db } from "@/lib/db";

export interface CreateQuoteInput {
  orgId: string;
  caseId?: string;
  number: string;
  title: string;
  currency?: string;
  amountCents: number;
  validUntil?: Date;
  notes?: string;
}

export interface UpdateQuoteInput {
  title?: string;
  currency?: string;
  amountCents?: number;
  status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  validUntil?: Date;
  notes?: string;
}

export async function createQuote(input: CreateQuoteInput) {
  return db.quote.create({
    data: {
      orgId: input.orgId,
      caseId: input.caseId,
      number: input.number,
      title: input.title,
      currency: input.currency ?? "CHF",
      amountCents: input.amountCents,
      validUntil: input.validUntil,
      notes: input.notes,
    },
  });
}

export async function getQuote(id: string) {
  return db.quote.findUnique({
    where: { id },
  });
}

export async function getQuoteByNumber(number: string) {
  return db.quote.findUnique({
    where: { number },
  });
}

export async function getQuotes(orgId: string, filters?: {
  caseId?: string;
  status?: string;
}) {
  return db.quote.findMany({
    where: {
      orgId,
      ...(filters?.caseId ? { caseId: filters.caseId } : undefined),
      ...(filters?.status ? { status: filters.status } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateQuote(id: string, input: UpdateQuoteInput) {
  return db.quote.update({
    where: { id },
    data: input,
  });
}

export async function deleteQuote(id: string) {
  return db.quote.delete({
    where: { id },
  });
}
