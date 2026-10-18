import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler } from "@/lib/api-helpers";
import { buildIcs, verifyIcsLinkToken } from "@/lib/services/ics";
import { DomainError } from "@/lib/domain/states";

/**
 * GET /api/consultations/[id]/ics — RFC 5545 calendar invite download.
 *
 * Access: either an authenticated session (any role of the org) OR a
 * TIME-LIMITED link token `?t=<expiresAtMs>.<hmac>` (so the emailed/attached
 * invite opens without a session — the HMAC is bound to AUTH_SECRET, the
 * consultation id and the expiry, and the token is refused once it lapses).
 * When AUTH_SECRET is not configured, token access fails closed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    // Token path — allows calendar clients / email links without a session.
    const provided = r.nextUrl.searchParams.get("t");
    let consultation;
    if (!provided) {
      // No token → require an authenticated session first (also closes the
      // anonymous existence oracle), then resolve inside the caller org.
      const { requireAuth } = await import("@/lib/auth");
      const ctx = await requireAuth(r);
      consultation = await withTenantContext(ctx.orgId, (tx) =>
        tx.consultation.findUnique({
          where: { id },
          select: {
            id: true,
            orgId: true,
            leadName: true,
            leadEmail: true,
            programmeKey: true,
            scheduledAt: true,
            durationMin: true,
            notes: true,
            status: true,
          },
        })
      );
      if (!consultation) throw new DomainError("Consultation not found", 404);
      if (ctx.orgId !== consultation.orgId)
        throw new DomainError("Forbidden", 403);
    } else {
      // Token-authorized read stays global: the HMAC is the authorization.
      // Post-cutover this path needs the service identity (tracked program).
      consultation = await db.consultation.findUnique({
        where: { id },
        select: {
          id: true,
          orgId: true,
          leadName: true,
          leadEmail: true,
          programmeKey: true,
          scheduledAt: true,
          durationMin: true,
          notes: true,
          status: true,
        },
      });
      if (!consultation) throw new DomainError("Consultation not found", 404);
      if (!verifyIcsLinkToken(id, provided))
        throw new DomainError("Invalid invite token", 403);
    }

    const ics = buildIcs({
      uid: `consultation-${consultation.id}@citizen-lane`,
      title: `Citizen Lane — ${
        consultation.programmeKey ? `${consultation.programmeKey} ` : ""
      }consultation`,
      description:
        consultation.notes ??
        "Consultation with your Citizen Lane relationship manager.",
      location: "Video call / Citizen Lane office",
      start: consultation.scheduledAt,
      durationMin: consultation.durationMin,
      organizerName: "Citizen Lane",
      organizerEmail: "info@citizen-lane.com",
      attendeeName: consultation.leadName,
      attendeeEmail: consultation.leadEmail,
      alarmMin: 60,
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="citizen-lane-consultation.ics"`,
        "Cache-Control": "no-store",
      },
    });
  })(req);
}
