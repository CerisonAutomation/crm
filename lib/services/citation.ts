import { db } from "@/lib/db";

export interface CreateCitationInput {
  aiRunId: string;
  sourceType: string;
  sourceId?: string;
  sourceLabel?: string;
  quote?: string;
  confidence?: number;
}

export async function createCitation(input: CreateCitationInput) {
  return db.citation.create({
    data: {
      aiRunId: input.aiRunId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLabel: input.sourceLabel,
      quote: input.quote,
      confidence: input.confidence,
    },
  });
}

export async function getCitation(id: string) {
  return db.citation.findUnique({
    where: { id },
  });
}

export async function getCitations(aiRunId: string) {
  return db.citation.findMany({
    where: { aiRunId },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateCitation(
  id: string,
  data: { confidence?: number; quote?: string }
) {
  return db.citation.update({
    where: { id },
    data,
  });
}

export async function deleteCitation(id: string) {
  return db.citation.delete({
    where: { id },
  });
}
