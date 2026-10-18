import { db } from "@/lib/db";

export interface CreateWebhookInboxInput {
  orgId: string;
  endpointId?: string;
  provider: string;
  providerEventId?: string;
  payloadHash: string;
  payload: string;
  signature?: string;
  signatureValid?: boolean;
}

export async function createWebhookInboxEntry(input: CreateWebhookInboxInput) {
  return db.webhookInbox.create({
    data: {
      orgId: input.orgId,
      endpointId: input.endpointId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      payloadHash: input.payloadHash,
      payload: input.payload,
      signature: input.signature,
      signatureValid: input.signatureValid ?? false,
    },
  });
}

export async function getWebhookInboxEntry(id: string) {
  return db.webhookInbox.findUnique({
    where: { id },
  });
}

export async function getWebhookInboxEntries(orgId: string, filters?: {
  status?: string;
  provider?: string;
}) {
  return db.webhookInbox.findMany({
    where: {
      orgId,
      ...(filters?.status ? { status: filters.status } : undefined),
      ...(filters?.provider ? { provider: filters.provider } : undefined),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function markWebhookProcessing(id: string) {
  return db.webhookInbox.update({
    where: { id },
    data: { status: "PROCESSING" },
  });
}

export async function markWebhookProcessed(id: string) {
  return db.webhookInbox.update({
    where: { id },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}

export async function quarantineWebhook(id: string, error: string) {
  return db.webhookInbox.update({
    where: { id },
    data: { status: "QUARANTINED", error },
  });
}
