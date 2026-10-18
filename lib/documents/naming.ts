/**
 * Document naming convention utility.
 */
import type { DocumentRow } from "@/lib/api-client";

export type DocTypeKey =
  | "PASSPORT"
  | "NATIONAL_ID"
  | "POLICE_RECORD"
  | "CERTIFICATE_OF_REGISTRATION"
  | "BANK_STATEMENT"
  | "OTHER";

export function sanitiseFilenamePart(part: string): string {
  return part
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

export function buildClientId(firstName?: string | null, lastName?: string | null): string {
  const surname = sanitiseFilenamePart(lastName ?? "CLIENT");
  const initial = firstName ? sanitiseFilenamePart(firstName.charAt(0)) : "X";
  return `${surname}-${initial}`;
}

export function buildDocumentName(params: {
  date: Date;
  clientId: string;
  docType: DocTypeKey;
  version: number;
  originalName: string;
}): string {
  const dateStr = params.date.toISOString().split("T")[0];
  const rawExt = params.originalName.includes(".") ? params.originalName.split(".").pop()?.toLowerCase() : "";
  const ext = rawExt || "bin";
  const typeStr = params.docType.replace(/_/g, "-");
  return `${dateStr}_${params.clientId}_${typeStr}_${params.version}.${ext}`;
}

export function parseDocumentName(filename: string): {
  date: string | null;
  clientId: string | null;
  docType: string | null;
  version: number | null;
  ext: string | null;
  valid: boolean;
} {
  const match = filename.match(
    /^(\d{4}-\d{2}-\d{2})_([A-Z0-9-]+)_([A-Z0-9-]+)_(\d+)\.([a-z0-9]+)$/i
  );
  if (!match) return { date: null, clientId: null, docType: null, version: null, ext: null, valid: false };
  return {
    date: match[1],
    clientId: match[2],
    docType: match[3],
    version: parseInt(match[4], 10),
    ext: match[5].toLowerCase(),
    valid: true,
  };
}

export function getNextVersion(existingDocs: DocumentRow[], clientId: string, docType: DocTypeKey): number {
  const prefix = `${clientId}_${docType.replace(/_/g, "-")}_`;
  let max = 0;
  for (const doc of existingDocs) {
    const parsed = parseDocumentName(doc.fileName);
    if (parsed.valid && parsed.clientId === clientId && parsed.docType === docType.replace(/_/g, "-")) {
      if (parsed.version && parsed.version > max) max = parsed.version;
    }
  }
  return max + 1;
}

export function validateDocumentName(filename: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const parsed = parseDocumentName(filename);

  if (!parsed.valid) {
    errors.push("Filename does not match the standard convention: YYYY-MM-DD_ClientID_Type_Version.ext");
    return { valid: false, errors };
  }

  const date = new Date(parsed.date! + "T00:00:00");
  if (isNaN(date.getTime())) {
    errors.push("Date part is not a valid ISO date (YYYY-MM-DD)");
  }

  if (parsed.version === null || parsed.version < 1) {
    errors.push("Version must be a positive integer");
  }

  const allowedExts = ["pdf", "png", "jpg", "jpeg", "webp"];
  if (!allowedExts.includes(parsed.ext!)) {
    errors.push(`Extension must be one of: ${allowedExts.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

export const NAMING_CONVENTION_HINT = {
  pattern: "YYYY-MM-DD_Surname-I_Type_Version.ext",
  example: "2025-01-15_Mueller-H_PASSPORT_1.pdf",
  parts: [
    { label: "Date", value: "YYYY-MM-DD", description: "Upload date (or document issuance date if known)" },
    { label: "Client", value: "Surname-I", description: "Client surname + first initial (e.g. Mueller-H)" },
    { label: "Type", value: "PASSPORT | BANK_STATEMENT | ...", description: "Document type from the standard list" },
    { label: "Version", value: "1, 2, 3...", description: "Auto-increments for re-uploads of the same type" },
    { label: "Extension", value: "pdf | png | jpg", description: "Original file extension, lowercase" },
  ],
} as const;
