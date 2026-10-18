import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import {
  buildEn16931Xml,
  buildEpcPayload,
  sha256Hex,
  type Creditor,
} from "@/lib/adapters/einvoice";

/**
 * POST /api/finance/[id]/qr — export a live invoice as Swiss QR-bill EPC
 * payload, EN 16931 CII XML, or slip JSON. Read-only: the invoice row is
 * never mutated (hash of the export is audit-recorded instead).
 * Body: { creditor: { name, street, building, zipCity, country, iban },
 *         format: "epc" | "en16931" | "slip" }.
 * Auth: owning client, or staff in the same organisation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const invoice = await db.invoice.findUnique({ where: { id } });
    if (!invoice) throw new DomainError("Invoice not found", 404);
    if (ctx.role === "CLIENT") {
      if (invoice.clientId !== ctx.userId)
        throw new DomainError("Forbidden", 403);
    } else if (invoice.orgId !== ctx.orgId) {
      throw new DomainError("Forbidden", 403);
    }
    const body = await readJson<{ creditor?: Creditor; format?: string }>(r);
    if (!body.creditor || typeof body.creditor !== "object")
      throw new DomainError(
        "creditor { name, street, building, zipCity, country, iban } required",
        400
      );
    if (!["epc", "en16931", "slip"].includes(body.format ?? "")) {
      throw new DomainError(
        "Unknown format — expected epc, en16931 or slip",
        400
      );
    }
    const subjects = {
      number: invoice.number,
      title: invoice.title,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
    };
    let content: string;
    let contentType: string;
    let filename: string;
    try {
      if (body.format === "epc") {
        content = buildEpcPayload(subjects, body.creditor);
        contentType = "text/plain";
        filename = `${invoice.number}.epc.txt`;
      } else if (body.format === "en16931") {
        content = buildEn16931Xml(subjects, body.creditor);
        contentType = "application/xml";
        filename = `${invoice.number}.cii.xml`;
      } else {
        content = JSON.stringify(
          {
            invoice: {
              ...subjects,
              issuedAt: subjects.issuedAt?.toISOString() ?? null,
              dueAt: subjects.dueAt?.toISOString() ?? null,
            },
            creditor: {
              ...body.creditor,
              iban: body.creditor.iban.replace(/[\s-]/g, "").toUpperCase(),
            },
            epc: buildEpcPayload(subjects, body.creditor),
          },
          null,
          2
        );
        contentType = "application/json";
        filename = `${invoice.number}.slip.json`;
      }
    } catch (e) {
      throw new DomainError(
        e instanceof Error ? e.message : "Export failed",
        400
      );
    }
    const hash = sha256Hex(content);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "finance.invoice.exported",
      target: invoice.number,
      after: { format: body.format, filename, sha256: hash },
      correlationId,
    });
    return jsonOk({ filename, contentType, content, sha256: hash });
  })(req);
}
