import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";

export interface CreateAttachmentInput {
  orgId: string;
  caseId?: string;
  messageId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  storageKey: string;
  uploadedBy: string;
}

export async function createAttachment(input: CreateAttachmentInput) {
  try {
    return await db.attachment.create({
      data: {
        orgId: input.orgId,
        caseId: input.caseId,
        messageId: input.messageId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? 0,
        storageKey: input.storageKey,
        uploadedBy: input.uploadedBy,
      },
    });
  } catch (err) {
    throw new DomainError("Failed to create attachment", 500, { cause: err });
  }
}

export async function getAttachment(id: string) {
  try {
    return await db.attachment.findUnique({
      where: { id },
    });
  } catch (err) {
    throw new DomainError("Failed to get attachment", 500, { cause: err });
  }
}

export async function getAttachments(orgId: string, filters?: {
  caseId?: string;
  messageId?: string;
}) {
  try {
    return await db.attachment.findMany({
      where: {
        orgId,
        ...(filters?.caseId ? { caseId: filters.caseId } : undefined),
        ...(filters?.messageId ? { messageId: filters.messageId } : undefined),
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    throw new DomainError("Failed to get attachments", 500, { cause: err });
  }
}

export async function deleteAttachment(id: string) {
  try {
    return await db.attachment.delete({
      where: { id },
    });
  } catch (err) {
    throw new DomainError("Failed to delete attachment", 500, { cause: err });
  }
}
