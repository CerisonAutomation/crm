/**
 * Citizen Lane — letter data assembly (server-only).
 *
 * Pulls the live case dossier from Prisma for the letter templates and holds
 * the firm's standard fee schedule (business configuration, mirrored by the
 * engagement and receipt templates). Never import from client components.
 */
import { db } from "@/lib/db";
import { DOC_TYPE_LABELS, caseStatusLabel } from "@/lib/domain/states";
import { DEFAULT_BUSINESS, type BusinessConfig } from "@/lib/business/defaults";
import { loadPlatformSettings } from "@/lib/settings/store";
import type { LetterStyle } from "./letterhead";

// ── Letter types (stable machine slugs, encoded in the fileName) ────────────
export const LETTER_TYPES = [
  "APPROVAL_IN_PRINCIPLE",
  "FINAL_APPROVAL",
  "DOCUMENT_REQUEST",
  "ENGAGEMENT_FEE_PROPOSAL",
  "PAYMENT_RECEIPT",
] as const;
export type LetterType = (typeof LETTER_TYPES)[number];

/** Subject line for one letter kind — the business-configured template (admin-editable) with its `{ref}` token replaced by the case reference. */
export function letterSubjectFor(business: BusinessConfig, type: LetterType, caseRef: string): string {
  const template = business.letters.subjects[type] ?? DEFAULT_BUSINESS.letters.subjects[type];
  return template.replace(/\{ref\}/g, caseRef);
}

/** Encode type + sequence into a deterministic, parseable fileName. */
export function letterFileName(caseRef: string, sequence: number, type: LetterType): string {
  return `${caseRef}_${String(sequence).padStart(2, "0")}_${type}.pdf`;
}

const FILENAME_RE = /^([A-Z0-9-]+)_(\d{2,})_(APPROVAL_IN_PRINCIPLE|FINAL_APPROVAL|DOCUMENT_REQUEST|ENGAGEMENT_FEE_PROPOSAL|PAYMENT_RECEIPT)\.pdf$/;

/** Parse a generated fileName back into its parts (null when not a generated letter). */
export function parseLetterFileName(
  fileName: string,
): { caseRef: string; sequence: number; type: LetterType } | null {
  const m = FILENAME_RE.exec(fileName);
  if (!m) return null;
  return { caseRef: m[1], sequence: Number(m[2]), type: m[3] as LetterType };
}

export function letterRefOf(caseRef: string, sequence: number): string {
  return `${caseRef} / L-${String(sequence).padStart(2, "0")}`;
}

// ── Firm fee schedule (per programme key) ───────────────────────────────────

export type FeeLine = { item: string; chf: number | null };

export type FeeSchedule = {
  lines: FeeLine[];
  terms: string[];
};

export function feeScheduleFor(
  programmeKey: string | null | undefined,
  programmeName: string | null,
  business: BusinessConfig = DEFAULT_BUSINESS,
): FeeSchedule {
  const fees = business.fees;
  const professional = fees.perProgramme[programmeKey ?? ""] ?? fees.defaultProfessional;
  const programme = programmeName ? `${programmeName} authority charges` : "competent authority charges";
  return {
    lines: [
      { item: fees.professionalLineLabel, chf: professional },
      { item: fees.governmentLineLabel.replace(/\{programme\}/g, programme), chf: null },
      { item: fees.disbursementsLineLabel, chf: null },
    ],
    terms: fees.terms,
  };
}

export function professionalFeeOf(
  programmeKey: string | null | undefined,
  business: BusinessConfig = DEFAULT_BUSINESS,
): number {
  return business.fees.perProgramme[programmeKey ?? ""] ?? business.fees.defaultProfessional;
}

// ── Template input ──────────────────────────────────────────────────────────

export type LetterIssuer = { name: string; role: string };

export type TemplateInput = {
  data: LetterData;
  /** "CL-2025-0001 / L-03" — printed on the letter. */
  letterRef: string;
  sequence: number;
  date: Date;
  issuer: LetterIssuer;
  /** Admin-editable firm/fee/letter copy (canon when nothing is stored). */
  business: BusinessConfig;
  /** Letterhead copy resolved from business + brand settings. */
  style: LetterStyle;
};

export type RenderedLetter = { buffer: Buffer; pages: number; title: string };

/** Signature block role label (business-configured; canon fallback). */
export function issuerRoleLabel(role: string, business: BusinessConfig = DEFAULT_BUSINESS): string {
  return business.letters.issuerRoles[role] ?? "Relationship Management";
}

// ── Dossier assembly ────────────────────────────────────────────────────────

export type LetterRequestLine = {
  docType: string;
  label: string;
  title: string;
  instructions: string;
  dueDate: Date | null;
  flexible: boolean;
  status: string;
};

export type LetterData = {
  caseId: string;
  caseRef: string;
  caseStatus: string;
  dataApproval: string | null;
  serviceApproval: string | null;
  client: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    nationality: string | null;
  };
  programme: { key: string; name: string; country: string; description: string } | null;
  outstandingRequests: LetterRequestLine[];
  rmName: string | null;
};

/** Load the live dossier a letter is generated from. Throws DomainError on 404. */
export async function loadLetterData(caseId: string): Promise<LetterData> {
  const { DomainError } = await import("@/lib/domain/states");
  const c = await db.case.findUnique({
    where: { id: caseId },
    include: {
      client: {
        select: {
          id: true, name: true, address: true, city: true, country: true, nationality: true,
        },
      },
      programme: true,
      requests: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
      assignments: { include: { user: { select: { name: true, role: true } } } },
    },
  });
  if (!c) throw new DomainError("Case not found", 404);

  const platform = await loadPlatformSettings();

  const outstanding = c.requests
    .filter((r) => r.status === "OPEN" || r.status === "OVERDUE")
    .map((r) => ({
      docType: r.docType,
      label: platform.labels.docTypes[r.docType] ?? DOC_TYPE_LABELS[r.docType] ?? r.docType,
      title: r.title,
      instructions: r.instructions,
      dueDate: r.dueDate,
      flexible: r.flexible,
      status: r.status,
    }));

  const rmAssignment = c.assignments.find((a) => a.user.role === "RM" || a.user.role === "SENIOR_RM");

  return {
    caseId: c.id,
    caseRef: c.reference,
    caseStatus: platform.labels.caseStatuses[c.status] ?? caseStatusLabel(c.status),
    dataApproval: c.dataApproval,
    serviceApproval: c.serviceApproval,
    client: c.client,
    programme: c.programme
      ? { key: c.programme.key, name: c.programme.name, country: c.programme.country, description: c.programme.description }
      : null,
    outstandingRequests: outstanding,
    rmName: rmAssignment?.user.name ?? null,
  };
}
