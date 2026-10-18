import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { buildVCard, vcardFileName } from "@/lib/integrations/vcard";

export const dynamic = "force-dynamic";

/**
 * GET /api/contacts/vcard?caseId=…|consultationId=… — a vCard 3.0 file for
 * Apple Contacts (macOS/iOS), Google Contacts or Outlook.
 *
 * Object-level authorisation: staff are scoped to their organisation, a client
 * may only export their own case contact. Served as `text/vcard`.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const params = new URL(r.url).searchParams;
    const caseId = params.get("caseId");
    const consultationId = params.get("consultationId");

    let card: string;
    let name: string;

    if (consultationId) {
      const c = await db.consultation.findUnique({ where: { id: consultationId } });
      if (!c) throw new DomainError("Consultation not found", 404);
      if (ctx.role === "CLIENT" ? c.leadEmail !== ctx.email : c.orgId !== ctx.orgId) {
        throw new DomainError("Forbidden", 403);
      }
      name = c.leadName;
      card = buildVCard({
        fullName: c.leadName,
        organisation: "Citizen Lane — prospective client",
        title: c.programmeKey ? `Programme: ${c.programmeKey}` : null,
        phones: c.leadPhone ? [{ value: c.leadPhone, type: "CELL" }] : [],
        emails: [c.leadEmail],
        note: c.notes ?? null,
        uid: `consultation-${c.id}`,
      });
    } else if (caseId) {
      const kase = await db.case.findUnique({
        where: { id: caseId },
        include: {
          client: {
            select: { id: true, name: true, firstName: true, lastName: true, email: true, phone: true, city: true, country: true, address: true, nationality: true },
          },
        },
      });
      if (!kase) throw new DomainError("Case not found", 404);
      if (ctx.role === "CLIENT" ? kase.clientId !== ctx.userId : kase.orgId !== ctx.orgId) {
        throw new DomainError("Forbidden", 403);
      }
      const client = kase.client;
      name = client.name;
      card = buildVCard({
        firstName: client.firstName,
        lastName: client.lastName,
        fullName: client.name,
        organisation: kase.reference,
        title: client.nationality ? `Nationality: ${client.nationality}` : null,
        phones: client.phone ? [{ value: client.phone, type: "CELL" }] : [],
        emails: [client.email],
        addresses: client.address || client.city || client.country
          ? [{ street: client.address ?? "", city: client.city ?? "", country: client.country ?? "" }]
          : [],
        uid: `case-${kase.id}`,
      });
    } else {
      throw new DomainError("caseId or consultationId required", 400);
    }

    return new Response(card, {
      status: 200,
      headers: {
        "content-type": "text/vcard; charset=utf-8",
        "content-disposition": `attachment; filename="${vcardFileName(name)}"`,
        "cache-control": "no-store",
      },
    });
  })(req);
}
