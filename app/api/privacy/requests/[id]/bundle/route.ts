import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, audit } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { buildDsarBundle, dsarClockName } from "@/lib/services/dsar-bundle";
import { markSLAMet } from "@/lib/services/sla";

export const dynamic = "force-dynamic";

/**
 * GET /api/privacy/requests/[id]/bundle — download the DSAR bundle as a ZIP.
 * Owner-self or same-org staff. Downloading fulfills an OPEN/IN_PROGRESS
 * ticket and stops its 30-day SLA clock (both idempotent on re-download).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const ticket = await db.gdprRequest.findUnique({ where: { id } });
    if (!ticket) throw new DomainError("Request not found", 404);
    if (ticket.userId !== ctx.userId) {
      const owner = await db.user.findUnique({
        where: { id: ticket.userId },
        select: { orgId: true },
      });
      if (!owner || owner.orgId !== ctx.orgId)
        throw new DomainError("Request not found", 404);
    }
    const bundle = await buildDsarBundle(ticket.userId);

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "profile.json",
      JSON.stringify(
        {
          exportedAt: bundle.exportedAt,
          lawfulBasis: bundle.lawfulBasis,
          retention: bundle.retention,
          user: bundle.user,
        },
        null,
        2
      )
    );
    zip.file("cases.json", JSON.stringify(bundle.cases, null, 2));
    zip.file("documents.json", JSON.stringify(bundle.documents, null, 2));
    zip.file(
      "notifications.json",
      JSON.stringify(bundle.notifications, null, 2)
    );
    zip.file("consent.json", JSON.stringify(bundle.consent, null, 2));
    zip.file("requests.json", JSON.stringify(bundle.requests, null, 2));
    zip.file(
      "manifest.json",
      JSON.stringify(
        {
          requestId: ticket.id,
          kind: ticket.kind,
          exportedAt: bundle.exportedAt,
          exportedBy: { id: ctx.userId, label: ctx.name },
          fileCount: 7,
          generatedBy: "Citizen Lane DSAR Bundle Export",
        },
        null,
        2
      )
    );
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });

    // Fulfillment: first download closes the ticket and stops the SLA clock.
    // Both writes are conditional, so a re-download is a metadata no-op.
    if (ticket.status === "OPEN" || ticket.status === "IN_PROGRESS") {
      await db.gdprRequest.update({
        where: { id },
        data: { status: "FULFILLED" },
      });
    }
    const clock = await db.sLAClock.findFirst({
      where: { name: dsarClockName(ticket.id), status: "ACTIVE" },
      select: { id: true, orgId: true },
    });
    if (clock) {
      await markSLAMet(clock.id, clock.orgId).catch(() => undefined);
    }
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "privacy.request.fulfilled",
      target: ticket.id,
      after: { kind: ticket.kind, slaStopped: Boolean(clock) },
      correlationId,
    });
    return new Response(zipBlob, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="dsar-${ticket.id}.zip"`,
      },
    });
  })(req);
}
