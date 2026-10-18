import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { storageGet } from "@/lib/storage";
import {
  LETTER_TYPES, parseLetterFileName, letterRefOf, loadLetterData, type LetterType,
} from "@/lib/documents/letter-data";
import { renderLetter } from "@/lib/documents/templates";
import { loadBusinessSettings } from "@/lib/business/settings";
import { loadBrandSettings } from "@/lib/brand/settings";
import { letterStyleFor } from "@/lib/documents/letterhead";

const LETTER_TYPE_SET = new Set<string>(LETTER_TYPES);

/**
 * Recover the letter kind for a record whose fileName was not produced by
 * `letterFileName()`. Generated names parse exactly; seeded/sandbox rows carry a
 * loose stem ("approval-in-principle.pdf"), so the stem is normalised to the
 * slug and matched against the known types. Null when neither form is known —
 * the caller then reports the missing file rather than inventing one.
 */
function inferLetterType(fileName: string): LetterType | null {
  const parsed = parseLetterFileName(fileName);
  if (parsed) return parsed.type;
  const stem = fileName.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  return LETTER_TYPE_SET.has(stem) ? (stem as LetterType) : null;
}

// GET /api/letters/[id]/download — the PDF bytes for one letter.
//
// Both consoles list letters and offer a per-row Download; this is the route
// those buttons call. It was missing entirely, so every per-row download failed
// even though the letters themselves are real and stored in the vault. Auth and
// tenancy mirror GET /api/cases/[id]/letter: a client may read only a letter on
// their own case, staff only within their own organisation.
//
// Bytes are served from the vault when present. Seeded/sandbox records have a
// `sandbox://` key with nothing behind it, so for those the letter is re-rendered
// from the live case dossier through the same template used at issuance — the
// download then yields the genuine letter for that case instead of a dead link.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    // Tenant-scoped letter lookup: bytes stream only after this resolves in-org.
    const letter = await withTenantContext(ctx.orgId, (tx) =>
      tx.approvalLetter.findUnique({
        where: { id },
        include: { case: { select: { id: true, orgId: true, clientId: true } } },
      }),
    );
    if (!letter) throw new DomainError("Letter not found", 404);

    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "letter.read.own");
      if (letter.case.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    } else {
      requireCapability(ctx, "document.read.all");
      if (letter.case.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    }

    // Resolve from the vault first; fall back to regenerating the document only
    // when the object is genuinely unavailable and the kind is known.
    let buf: Buffer | null = null;
    try {
      buf = await storageGet(letter.storageKey);
    } catch {
      buf = null;
    }

    if (!buf) {
      const type = inferLetterType(letter.fileName);
      if (type) {
        const [data, business, brand] = await Promise.all([
          loadLetterData(letter.case.id),
          loadBusinessSettings(),
          loadBrandSettings(),
        ]);
        const sequence = parseLetterFileName(letter.fileName)?.sequence ?? letter.version;
        const rendered = await renderLetter(type, {
          data,
          letterRef: letterRefOf(data.caseRef, sequence),
          sequence,
          date: letter.createdAt,
          issuer: { name: "Citizen Lane", role: "RM" },
          business,
          style: letterStyleFor(business, brand),
        });
        buf = rendered.buffer;
      }
    }

    if (!buf) throw new DomainError("Letter file is not available", 404);

    return jsonOk({
      letter: { id: letter.id, fileName: letter.fileName, version: letter.version },
      download: buf.toString("base64"),
    });
  })(req);
}
